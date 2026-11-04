cmake_minimum_required(VERSION 3.22.1)
project(qortino_llm)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Keep the APK lean: CPU-only llama.cpp, no examples/tests/tools.
set(LLAMA_BUILD_COMMON OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_TOOLS OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_SERVER OFF CACHE BOOL "" FORCE)
set(GGML_OPENMP OFF CACHE BOOL "" FORCE)
set(GGML_LLAMAFILE OFF CACHE BOOL "" FORCE)
set(GGML_NATIVE OFF CACHE BOOL "" FORCE)

if(ANDROID_ABI STREQUAL "arm64-v8a")
    # One CPU backend library per ARM feature level (plain, dotprod, fp16,
    # i8mm, SVE2/SME); qortino_llm_jni.cpp loads the best one this phone's CPU
    # reports it can run. A single build for dotprod + i8mm was fast on new
    # phones but would hit illegal instructions on chips without i8mm
    # (Snapdragon 865/888, Tensor G1/G2 and older); slower generic kernels
    # for every phone were not an option either.
    set(BUILD_SHARED_LIBS ON CACHE BOOL "" FORCE)
    set(GGML_BACKEND_DL ON CACHE BOOL "" FORCE)
    set(GGML_CPU_ALL_VARIANTS ON CACHE BOOL "" FORCE)
    set(GGML_CPU_ARM_ARCH "" CACHE STRING "" FORCE)
else()
    # x86_64 only runs on emulators: one baseline build.
    set(BUILD_SHARED_LIBS OFF CACHE BOOL "" FORCE)
    set(GGML_BACKEND_DL OFF CACHE BOOL "" FORCE)
    set(GGML_CPU_ALL_VARIANTS OFF CACHE BOOL "" FORCE)
endif()

add_subdirectory(llama.cpp)

add_library(qortino_llm SHARED qortino_llm_jni.cpp)

if(ANDROID_ABI STREQUAL "arm64-v8a")
    target_compile_definitions(qortino_llm PRIVATE QORTINO_CPU_VARIANTS=1)
endif()

find_library(log-lib log)
find_library(android-lib android)

target_include_directories(qortino_llm PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/llama.cpp/include
    ${CMAKE_CURRENT_SOURCE_DIR}/llama.cpp/ggml/include
)

target_link_libraries(qortino_llm
    llama
    ${log-lib}
    ${android-lib}
)

# libc++ is linked in statically (ANDROID_STL=c++_static); keep its symbols
# private so libqortino_llm exports only the JNI entry points.
target_link_options(qortino_llm PRIVATE "-Wl,--exclude-libs,ALL")
