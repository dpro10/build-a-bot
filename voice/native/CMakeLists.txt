# nemo-voice: Build-a-bot's speech sidecar on NVIDIA NeMo-Speech.cpp's C ABI.
#   cmake -S voice/native -B build -DCMAKE_PREFIX_PATH=/path/to/nemo-speech && cmake --build build
cmake_minimum_required(VERSION 3.26)
project(nemo_voice LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
if(NOT CMAKE_BUILD_TYPE)
  set(CMAKE_BUILD_TYPE Release)
endif()

find_package(NeMoSpeech 0.2 REQUIRED COMPONENTS ASR TTS)
find_package(Threads REQUIRED)

add_executable(nemo-voice nemo-voice.cpp)
target_compile_options(nemo-voice PRIVATE -Wall -Wextra)
target_link_libraries(nemo-voice PRIVATE NeMoSpeech::ASR NeMoSpeech::TTS Threads::Threads)
# Run from the engine's own bin/ next to its lib/, the way NVIDIA's CLI is laid out.
set_target_properties(nemo-voice PROPERTIES INSTALL_RPATH "$ORIGIN:$ORIGIN/../lib")
install(TARGETS nemo-voice RUNTIME DESTINATION bin)
