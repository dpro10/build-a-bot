// nemo-voice: NVIDIA NeMo-Speech.cpp behind a small framed protocol on stdin/stdout, for
// Build-a-bot's voice server (voice/src/speech/sidecar.ts).
//
// One process holds the models for every call: Parakeet hears one utterance at a time, and
// Magpie speaks, streamed chunk by chunk as it's generated and stoppable mid-sentence, so a
// caller can interrupt. Only the stable C ABI is used (nemo_speech/asr.h, nemo_speech/tts.h),
// so this builds against NVIDIA's release archive or a native build of the same version.
//
// Frames, both ways, little-endian: u8 type | u32 id | u32 length | payload.
//   in   0x01 SPEAK   u32 sample_rate | u16 n, voice | u16 n, language | text (UTF-8)
//        0x02 CANCEL  stop the SPEAK with this id (queued or playing)
//        0x03 HEAR    u32 sample_rate | u16 n, language | u32 n, phrases ("\n"-separated) | PCM16 mono
//        0x04 PING
//   out  0x81 READY   JSON {version, asr, tts, voices, sample_rate}
//        0x82 AUDIO   PCM16 mono at the requested rate, for SPEAK id
//        0x83 SPOKEN  JSON {status: ok|cancelled|error, error?, ttfa_ms, rtfx, audio_s, elapsed_s}
//        0x84 HEARD   JSON {text, confidence, language, audio_s, elapsed_ms} or {error}
//        0x85 PONG
//        0x86 FATAL   JSON {error}, then exit 1
// stdout carries frames only: whatever the libraries print goes to stderr.

#include <nemo_speech/asr.h>
#include <nemo_speech/tts.h>

#include <algorithm>
#include <atomic>
#include <cerrno>
#include <chrono>
#include <condition_variable>
#include <csignal>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <deque>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

#include <unistd.h>

namespace {

enum : uint8_t {
    kSpeak = 0x01,
    kCancel = 0x02,
    kHear = 0x03,
    kPing = 0x04,
    kReady = 0x81,
    kAudio = 0x82,
    kSpoken = 0x83,
    kHeard = 0x84,
    kPong = 0x85,
    kFatal = 0x86,
};

constexpr uint32_t kMaxFrame = 32u << 20;  // 32 MB: ~17 minutes of 16 kHz audio

using Clock = std::chrono::steady_clock;

double ms_since(Clock::time_point t0) {
    return std::chrono::duration<double, std::milli>(Clock::now() - t0).count();
}

// ---- output -------------------------------------------------------------------------------

int g_out = -1;
std::mutex g_out_mu;

bool write_all(int fd, const uint8_t* p, size_t n) {
    while (n > 0) {
        ssize_t w = ::write(fd, p, n);
        if (w < 0) {
            if (errno == EINTR) continue;
            return false;
        }
        p += w;
        n -= static_cast<size_t>(w);
    }
    return true;
}

void put_u32(uint8_t* p, uint32_t v) {
    p[0] = static_cast<uint8_t>(v);
    p[1] = static_cast<uint8_t>(v >> 8);
    p[2] = static_cast<uint8_t>(v >> 16);
    p[3] = static_cast<uint8_t>(v >> 24);
}

void send(uint8_t type, uint32_t id, const void* data, size_t n) {
    uint8_t head[9];
    head[0] = type;
    put_u32(head + 1, id);
    put_u32(head + 5, static_cast<uint32_t>(n));
    std::lock_guard<std::mutex> lock(g_out_mu);
    // The parent is gone: nothing left to do.
    if (!write_all(g_out, head, sizeof head) || (n && !write_all(g_out, static_cast<const uint8_t*>(data), n))) {
        std::_Exit(0);
    }
}

void send_json(uint8_t type, uint32_t id, const std::string& json) { send(type, id, json.data(), json.size()); }

std::string quote(const char* s) {
    std::string out = "\"";
    for (const unsigned char* p = reinterpret_cast<const unsigned char*>(s ? s : ""); *p; ++p) {
        switch (*p) {
            case '"': out += "\\\""; break;
            case '\\': out += "\\\\"; break;
            case '\n': out += "\\n"; break;
            case '\r': out += "\\r"; break;
            case '\t': out += "\\t"; break;
            default:
                if (*p < 0x20) {
                    char buf[8];
                    std::snprintf(buf, sizeof buf, "\\u%04x", *p);
                    out += buf;
                } else {
                    out += static_cast<char>(*p);
                }
        }
    }
    return out + "\"";
}

std::string num(double v) {
    char buf[32];
    std::snprintf(buf, sizeof buf, "%.3f", v);
    return buf;
}

[[noreturn]] void fatal(const std::string& message) {
    std::fprintf(stderr, "nemo-voice: %s\n", message.c_str());
    if (g_out >= 0) send_json(kFatal, 0, "{\"error\":" + quote(message.c_str()) + "}");
    std::exit(1);
}

// ---- input --------------------------------------------------------------------------------

bool read_exact(int fd, uint8_t* p, size_t n) {
    while (n > 0) {
        ssize_t r = ::read(fd, p, n);
        if (r == 0) return false;
        if (r < 0) {
            if (errno == EINTR) continue;
            return false;
        }
        p += r;
        n -= static_cast<size_t>(r);
    }
    return true;
}

struct Reader {
    const uint8_t* p;
    size_t left;
    bool ok = true;

    uint32_t u32() {
        if (left < 4) return fail();
        uint32_t v = p[0] | (p[1] << 8) | (p[2] << 16) | (static_cast<uint32_t>(p[3]) << 24);
        p += 4;
        left -= 4;
        return v;
    }
    uint16_t u16() {
        if (left < 2) return static_cast<uint16_t>(fail());
        uint16_t v = static_cast<uint16_t>(p[0] | (p[1] << 8));
        p += 2;
        left -= 2;
        return v;
    }
    std::string bytes(size_t n) {
        if (left < n) {
            fail();
            return {};
        }
        std::string s(reinterpret_cast<const char*>(p), n);
        p += n;
        left -= n;
        return s;
    }
    uint32_t fail() {
        ok = false;
        left = 0;
        return 0;
    }
};

// ---- options ------------------------------------------------------------------------------

struct Options {
    std::string asr_model, itn_dir;
    std::string tts_model, codec_model, tokenizer_dir, tn_dir;
    std::string voice;
    int gpu = -1;
    int tts_threads = 0;
    int codec_threads = 0;
    int chunk_frames = 0;
    int asr_workers = 1;
    bool cfg = true;
};

void usage() {
    std::fprintf(stderr,
                 "usage: nemo-voice [--asr-model GGUF [--itn-dir DIR] [--asr-workers N]]\n"
                 "                  [--tts-model GGUF --codec-model GGUF --tokenizer-dir DIR [--tn-dir DIR]\n"
                 "                   [--voice NAME] [--tts-threads N] [--codec-threads N] [--chunk-frames N] [--no-cfg]]\n"
                 "                  [--gpu N]\n");
}

Options parse(int argc, char** argv) {
    Options o;
    for (int i = 1; i < argc; ++i) {
        std::string a = argv[i];
        auto next = [&]() -> std::string {
            if (i + 1 >= argc) {
                usage();
                std::exit(2);
            }
            return argv[++i];
        };
        if (a == "--asr-model") o.asr_model = next();
        else if (a == "--itn-dir") o.itn_dir = next();
        else if (a == "--asr-workers") o.asr_workers = std::max(1, std::atoi(next().c_str()));
        else if (a == "--tts-model") o.tts_model = next();
        else if (a == "--codec-model") o.codec_model = next();
        else if (a == "--tokenizer-dir") o.tokenizer_dir = next();
        else if (a == "--tn-dir") o.tn_dir = next();
        else if (a == "--voice") o.voice = next();
        else if (a == "--tts-threads") o.tts_threads = std::atoi(next().c_str());
        else if (a == "--codec-threads") o.codec_threads = std::atoi(next().c_str());
        else if (a == "--chunk-frames") o.chunk_frames = std::atoi(next().c_str());
        else if (a == "--no-cfg") o.cfg = false;
        else if (a == "--gpu") o.gpu = std::atoi(next().c_str());
        else if (a == "-h" || a == "--help") {
            usage();
            std::exit(0);
        } else {
            std::fprintf(stderr, "nemo-voice: unknown option %s\n", a.c_str());
            usage();
            std::exit(2);
        }
    }
    return o;
}

// ---- speech synthesis (Magpie) ------------------------------------------------------------

nemo_speech_tts_synthesizer* g_tts = nullptr;
int g_tts_rate = 0;

struct SpeakRequest {
    uint32_t id;
    uint32_t sample_rate;
    std::string voice, language, text;
};

std::mutex g_tts_mu;
std::condition_variable g_tts_cv;
std::deque<SpeakRequest> g_tts_queue;
uint32_t g_tts_active = 0;  // id being synthesized (0 = none); guarded by g_tts_mu
std::atomic<bool> g_tts_cancel{false};
std::atomic<bool> g_stop{false};

struct SpeakContext {
    uint32_t id;
};

bool on_pcm(const uint8_t* pcm, size_t n, void* user) {
    if (g_tts_cancel.load(std::memory_order_relaxed)) return false;
    const auto* ctx = static_cast<SpeakContext*>(user);
    if (n) send(kAudio, ctx->id, pcm, n);
    return !g_tts_cancel.load(std::memory_order_relaxed);
}

bool discard_pcm(const uint8_t*, size_t, void*) { return true; }

void speak(const SpeakRequest& req) {
    nemo_speech_tts_synthesis_options opt = nemo_speech_tts_synthesis_options_default();
    opt.request_id = nullptr;
    opt.language_code = req.language.empty() ? nullptr : req.language.c_str();
    opt.voice_name = req.voice.empty() ? nullptr : req.voice.c_str();
    opt.output_sample_rate = static_cast<int32_t>(req.sample_rate);
    nemo_speech_tts_synthesis_stats stats = nemo_speech_tts_synthesis_stats_default();
    SpeakContext ctx{req.id};
    auto t0 = Clock::now();
    nemo_speech_tts_status st = nemo_speech_tts_synthesize_text(g_tts, &opt, req.text.c_str(), on_pcm, &ctx, &stats);
    double elapsed = ms_since(t0) / 1000.0;
    std::string json;
    if (st == NEMO_SPEECH_TTS_OK) {
        json = "{\"status\":\"ok\"";
    } else if (st == NEMO_SPEECH_TTS_ERROR_CANCELLED || g_tts_cancel.load()) {
        json = "{\"status\":\"cancelled\"";
    } else {
        json = "{\"status\":\"error\",\"error\":" + quote(nemo_speech_tts_last_error());
    }
    json += ",\"ttfa_ms\":" + num(stats.e2e_ttfa_ms > 0 ? stats.e2e_ttfa_ms : stats.ttfa_ms) + ",\"rtfx\":" +
            num(stats.e2e_rtfx > 0 ? stats.e2e_rtfx : stats.rtfx) + ",\"audio_s\":" + num(stats.audio_s) +
            ",\"elapsed_s\":" + num(elapsed) + "}";
    send_json(kSpoken, req.id, json);
}

void tts_worker() {
    for (;;) {
        SpeakRequest req;
        {
            std::unique_lock<std::mutex> lock(g_tts_mu);
            g_tts_cv.wait(lock, [] { return g_stop.load() || !g_tts_queue.empty(); });
            if (g_stop.load() && g_tts_queue.empty()) return;
            req = std::move(g_tts_queue.front());
            g_tts_queue.pop_front();
            g_tts_active = req.id;
            g_tts_cancel.store(false);
        }
        speak(req);
        std::lock_guard<std::mutex> lock(g_tts_mu);
        g_tts_active = 0;
        g_tts_cancel.store(false);
    }
}

void cancel_speak(uint32_t id) {
    bool dropped = false;
    {
        std::lock_guard<std::mutex> lock(g_tts_mu);
        for (auto it = g_tts_queue.begin(); it != g_tts_queue.end(); ++it) {
            if (it->id == id) {
                g_tts_queue.erase(it);
                dropped = true;
                break;
            }
        }
        if (!dropped && g_tts_active == id) g_tts_cancel.store(true);
    }
    if (dropped) send_json(kSpoken, id, "{\"status\":\"cancelled\",\"ttfa_ms\":0,\"rtfx\":0,\"audio_s\":0,\"elapsed_s\":0}");
}

// ---- speech recognition (Parakeet) --------------------------------------------------------

nemo_speech_asr_recognizer* g_asr = nullptr;

struct HearRequest {
    uint32_t id;
    uint32_t sample_rate;
    std::string language;
    std::vector<std::string> phrases;
    std::vector<float> samples;
};

std::mutex g_asr_mu;
std::condition_variable g_asr_cv;
std::deque<HearRequest> g_asr_queue;

void hear(const HearRequest& req) {
    nemo_speech_asr_recognition_options opt = nemo_speech_asr_recognition_options_default();
    opt.language_code = req.language.empty() ? nullptr : req.language.c_str();
    opt.enable_automatic_punctuation = true;
    std::vector<const char*> phrases;
    for (const auto& p : req.phrases) phrases.push_back(p.c_str());
    nemo_speech_asr_speech_context context{};
    context.size = sizeof context;
    context.phrases = phrases.data();
    context.phrase_count = phrases.size();
    context.boost = 4.0f;
    if (!phrases.empty()) {
        opt.speech_contexts = &context;
        opt.speech_context_count = 1;
    }
    auto t0 = Clock::now();
    nemo_speech_asr_result* res = nullptr;
    nemo_speech_asr_status st = nemo_speech_asr_recognize_f32(g_asr, &opt, req.samples.data(), req.samples.size(),
                                                            static_cast<int32_t>(req.sample_rate), &res);
    double elapsed = ms_since(t0);
    if (st != NEMO_SPEECH_ASR_OK || !res) {
        send_json(kHeard, req.id, "{\"error\":" + quote(nemo_speech_asr_last_error()) + "}");
        if (res) nemo_speech_asr_result_destroy(res);
        return;
    }
    const char* text = nemo_speech_asr_result_alternative_count(res) ? nemo_speech_asr_result_transcript(res, 0) : "";
    float confidence = nemo_speech_asr_result_alternative_count(res) ? nemo_speech_asr_result_confidence(res, 0) : 0.0f;
    const char* language = "";
    if (nemo_speech_asr_result_alternative_count(res) && nemo_speech_asr_result_language_count(res, 0)) {
        language = nemo_speech_asr_result_language_code(res, 0, 0);
    }
    double audio_s = req.sample_rate ? static_cast<double>(req.samples.size()) / req.sample_rate : 0.0;
    send_json(kHeard, req.id,
              "{\"text\":" + quote(text) + ",\"confidence\":" + num(confidence) + ",\"language\":" + quote(language) +
                  ",\"audio_s\":" + num(audio_s) + ",\"elapsed_ms\":" + num(elapsed) + "}");
    nemo_speech_asr_result_destroy(res);
}

void asr_worker() {
    for (;;) {
        HearRequest req;
        {
            std::unique_lock<std::mutex> lock(g_asr_mu);
            g_asr_cv.wait(lock, [] { return g_stop.load() || !g_asr_queue.empty(); });
            if (g_stop.load() && g_asr_queue.empty()) return;
            req = std::move(g_asr_queue.front());
            g_asr_queue.pop_front();
        }
        hear(req);
    }
}

// ---- setup --------------------------------------------------------------------------------

void load_asr(const Options& o) {
    nemo_speech_asr_backend_config backend{};
    backend.size = sizeof backend;
    backend.gpu = o.gpu;
    nemo_speech_asr_model_config model{};
    model.size = sizeof model;
    model.path = o.asr_model.c_str();
    nemo_speech_asr_postproc_config post{};
    post.size = sizeof post;
    post.itn_model_dir = o.itn_dir.empty() ? nullptr : o.itn_dir.c_str();
    nemo_speech_asr_recognizer_config cfg{};
    cfg.size = sizeof cfg;
    cfg.backend = &backend;
    cfg.model = &model;
    cfg.postproc = &post;
    if (nemo_speech_asr_create(&cfg, &g_asr) != NEMO_SPEECH_ASR_OK || !g_asr) {
        fatal(std::string("speech recognition didn't load: ") + nemo_speech_asr_last_error());
    }
    // The first decode allocates the graph: pay for it now, not on the first caller.
    std::vector<float> quiet(16000 / 2, 0.0f);
    for (size_t i = 0; i < quiet.size(); ++i) quiet[i] = 0.001f * static_cast<float>((i * 7919) % 13) / 13.0f;
    nemo_speech_asr_recognition_options opt = nemo_speech_asr_recognition_options_default();
    nemo_speech_asr_result* res = nullptr;
    if (nemo_speech_asr_recognize_f32(g_asr, &opt, quiet.data(), quiet.size(), 16000, &res) == NEMO_SPEECH_ASR_OK && res) {
        nemo_speech_asr_result_destroy(res);
    }
}

void load_tts(const Options& o) {
    nemo_speech_tts_model_config model{};
    model.size = sizeof model;
    model.magpie_model = o.tts_model.c_str();
    model.codec_model = o.codec_model.c_str();
    model.tokenizer_model_dir = o.tokenizer_dir.c_str();
    model.text_normalizer_model_dir = o.tn_dir.empty() ? nullptr : o.tn_dir.c_str();
    nemo_speech_tts_runtime_config rt = nemo_speech_tts_runtime_config_default();
    if (o.tts_threads > 0) rt.threads = o.tts_threads;
    if (o.codec_threads > 0) rt.codec_threads = o.codec_threads;
    if (o.chunk_frames > 0) rt.chunk_frames = o.chunk_frames;
    rt.use_cfg = o.cfg;
    nemo_speech_tts_synthesizer_config cfg{};
    cfg.size = sizeof cfg;
    cfg.model = &model;
    cfg.runtime = &rt;
    cfg.default_language_code = "en-US";
    cfg.default_voice_name = o.voice.empty() ? nullptr : o.voice.c_str();
    if (nemo_speech_tts_create(&cfg, &g_tts) != NEMO_SPEECH_TTS_OK || !g_tts) {
        fatal(std::string("speech synthesis didn't load: ") + nemo_speech_tts_last_error());
    }
    g_tts_rate = nemo_speech_tts_sample_rate(g_tts);
    nemo_speech_tts_synthesis_options opt = nemo_speech_tts_synthesis_options_default();
    nemo_speech_tts_synthesis_stats stats = nemo_speech_tts_synthesis_stats_default();
    if (nemo_speech_tts_synthesize_text(g_tts, &opt, "Hello there.", discard_pcm, nullptr, &stats) != NEMO_SPEECH_TTS_OK) {
        fatal(std::string("speech synthesis warmup failed: ") + nemo_speech_tts_last_error());
    }
}

std::string ready_json(const Options& o) {
    std::string voices = "[";
    if (g_tts) {
        int32_t n = nemo_speech_tts_speaker_count(g_tts);
        for (int32_t i = 0; i < n; ++i) {
            if (i) voices += ",";
            voices += quote(nemo_speech_tts_speaker_name(g_tts, static_cast<size_t>(i)));
        }
    }
    voices += "]";
    return "{\"version\":" + quote(g_tts ? nemo_speech_tts_version() : nemo_speech_asr_version()) +
           ",\"asr\":" + (g_asr ? "true" : "false") + ",\"tts\":" + (g_tts ? "true" : "false") + ",\"voices\":" + voices +
           ",\"voice\":" + quote(o.voice.c_str()) + ",\"sample_rate\":" + std::to_string(g_tts_rate) + "}";
}

void handle(uint8_t type, uint32_t id, const std::vector<uint8_t>& payload) {
    Reader r{payload.data(), payload.size()};
    switch (type) {
        case kSpeak: {
            SpeakRequest req;
            req.id = id;
            req.sample_rate = r.u32();
            req.voice = r.bytes(r.u16());
            req.language = r.bytes(r.u16());
            req.text = r.ok ? std::string(reinterpret_cast<const char*>(r.p), r.left) : std::string();
            if (!g_tts) {
                send_json(kSpoken, id, "{\"status\":\"error\",\"error\":\"speech synthesis isn't loaded\"}");
            } else if (!r.ok || req.text.empty() ||
                       (req.sample_rate && (req.sample_rate < 8000 || static_cast<int>(req.sample_rate) > g_tts_rate))) {
                send_json(kSpoken, id, "{\"status\":\"error\",\"error\":\"bad speak request\"}");
            } else {
                std::lock_guard<std::mutex> lock(g_tts_mu);
                g_tts_queue.push_back(std::move(req));
                g_tts_cv.notify_one();
            }
            break;
        }
        case kCancel:
            cancel_speak(id);
            break;
        case kHear: {
            HearRequest req;
            req.id = id;
            req.sample_rate = r.u32();
            req.language = r.bytes(r.u16());
            std::string phrases = r.bytes(r.u32());
            if (!r.ok || req.sample_rate < 8000 || req.sample_rate > 96000 || (r.left % 2) != 0) {
                send_json(kHeard, id, "{\"error\":\"bad hear request\"}");
                break;
            }
            if (!g_asr) {
                send_json(kHeard, id, "{\"error\":\"speech recognition isn't loaded\"}");
                break;
            }
            size_t start = 0;
            while (start < phrases.size()) {
                size_t end = phrases.find('\n', start);
                if (end == std::string::npos) end = phrases.size();
                if (end > start) req.phrases.push_back(phrases.substr(start, end - start));
                start = end + 1;
            }
            req.samples.resize(r.left / 2);
            for (size_t i = 0; i < req.samples.size(); ++i) {
                int16_t s = static_cast<int16_t>(r.p[2 * i] | (r.p[2 * i + 1] << 8));
                req.samples[i] = static_cast<float>(s) / 32768.0f;
            }
            std::lock_guard<std::mutex> lock(g_asr_mu);
            g_asr_queue.push_back(std::move(req));
            g_asr_cv.notify_one();
            break;
        }
        case kPing:
            send(kPong, id, nullptr, 0);
            break;
        default:
            std::fprintf(stderr, "nemo-voice: ignoring frame type %u\n", type);
    }
}

}  // namespace

int main(int argc, char** argv) {
    std::signal(SIGPIPE, SIG_IGN);
    // Frames get the real stdout; anything else printed to fd 1 lands on stderr.
    g_out = ::dup(1);
    if (g_out < 0 || ::dup2(2, 1) < 0) {
        std::perror("nemo-voice: dup");
        return 1;
    }
    Options o = parse(argc, argv);
    bool want_tts = !o.tts_model.empty() || !o.codec_model.empty() || !o.tokenizer_dir.empty();
    if (o.asr_model.empty() && !want_tts) {
        usage();
        return 2;
    }
    if (want_tts && (o.tts_model.empty() || o.codec_model.empty() || o.tokenizer_dir.empty())) {
        fatal("speech synthesis needs --tts-model, --codec-model and --tokenizer-dir");
    }

    auto t0 = Clock::now();
    if (!o.asr_model.empty()) load_asr(o);
    if (want_tts) load_tts(o);
    std::fprintf(stderr, "nemo-voice: ready in %.1f s (asr=%s, tts=%s)\n", ms_since(t0) / 1000.0, g_asr ? "on" : "off",
                 g_tts ? "on" : "off");

    std::vector<std::thread> workers;
    if (g_tts) workers.emplace_back(tts_worker);
    if (g_asr) {
        for (int i = 0; i < o.asr_workers; ++i) workers.emplace_back(asr_worker);
    }
    send_json(kReady, 0, ready_json(o));

    std::vector<uint8_t> payload;
    for (;;) {
        uint8_t head[9];
        if (!read_exact(0, head, sizeof head)) break;
        uint32_t id = head[1] | (head[2] << 8) | (head[3] << 16) | (static_cast<uint32_t>(head[4]) << 24);
        uint32_t len = head[5] | (head[6] << 8) | (head[7] << 16) | (static_cast<uint32_t>(head[8]) << 24);
        if (len > kMaxFrame) fatal("frame too large");
        payload.resize(len);
        if (len && !read_exact(0, payload.data(), len)) break;
        handle(head[0], id, payload);
    }

    // stdin closed: the voice server is gone. Stop what's playing and leave.
    g_stop.store(true);
    g_tts_cancel.store(true);
    {
        std::lock_guard<std::mutex> a(g_tts_mu);
        g_tts_queue.clear();
    }
    {
        std::lock_guard<std::mutex> b(g_asr_mu);
        g_asr_queue.clear();
    }
    g_tts_cv.notify_all();
    g_asr_cv.notify_all();
    for (auto& t : workers) t.join();
    if (g_tts) nemo_speech_tts_destroy(g_tts);
    if (g_asr) nemo_speech_asr_destroy(g_asr);
    return 0;
}
