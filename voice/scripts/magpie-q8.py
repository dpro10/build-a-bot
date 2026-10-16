"""NVIDIA's Magpie TTS, made faster on a CPU: its pinned F16 GGUF requantized to Q8_0.

`nemo-speech pull magpie` gets the F16 GGUF (so does fetch-models.sh); NVIDIA's benchmarks use a
Q8_0 one, which its converter (NeMo-Speech.cpp conversion/tts.py, --outtype q8_0) makes from the
1.5 GB .nemo checkpoint with PyTorch. This makes the same file from the F16 GGUF with just `gguf`
and numpy: the same tensors (attention and feed-forward projections, the local-transformer output
projections, the final projection) become Q8_0; everything else is copied unchanged.

Usage: python magpie-q8.py IN.f16.gguf OUT.q8_0.gguf
"""
import re
import sys

import numpy as np
from gguf import GGMLQuantizationType, GGUFReader, GGUFValueType, GGUFWriter
from gguf.quants import quantize

Q8_PROJECTION_WEIGHT = re.compile(
    r"(self_attention\.(qkv_net|o_net)\.weight"
    r"|cross_attention\.(q_net|kv_net|o_net)\.weight"
    r"|pos_ff\.(proj|o_net)\.conv\.weight\.k\d+"
    r"|local_transformer_out_projections\.\d+\.weight"
    r"|final_proj\.weight)$"
)


def field_value(field):
    kind = field.types[0]
    if kind == GGUFValueType.ARRAY:
        sub = field.types[-1]
        if sub == GGUFValueType.STRING:
            return [bytes(field.parts[i]).decode("utf-8") for i in field.data]
        return [field.parts[i].tolist()[0] for i in field.data]
    if kind == GGUFValueType.STRING:
        return bytes(field.parts[field.data[0]]).decode("utf-8")
    return field.parts[field.data[0]].tolist()[0]


def main(src: str, dst: str) -> None:
    reader = GGUFReader(src)
    arch = field_value(reader.fields["general.architecture"])
    writer = GGUFWriter(dst, arch)
    for name, field in reader.fields.items():
        if name.startswith("GGUF.") or name == "general.architecture":
            continue
        value = field_value(field)
        if name == "general.file_type":
            value = 7  # MOSTLY_Q8_0, as the converter records it
        kind = field.types[0]
        sub = field.types[-1] if kind == GGUFValueType.ARRAY else None
        writer.add_key_value(name, value, kind, sub_type=sub)
    converted = 0
    for t in reader.tensors:
        data = t.data
        if (
            t.tensor_type == GGMLQuantizationType.F16
            and data.ndim == 2
            and data.shape[-1] % 32 == 0
            and Q8_PROJECTION_WEIGHT.search(t.name)
        ):
            q8 = quantize(np.asarray(data, dtype=np.float32), GGMLQuantizationType.Q8_0)
            writer.add_tensor(t.name, q8, raw_dtype=GGMLQuantizationType.Q8_0)
            converted += 1
        else:
            writer.add_tensor(t.name, np.asarray(data), raw_dtype=t.tensor_type)
    writer.write_header_to_file()
    writer.write_kv_data_to_file()
    writer.write_tensors_to_file()
    writer.close()
    print(f"{converted} projection tensors -> Q8_0 of {len(reader.tensors)}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
