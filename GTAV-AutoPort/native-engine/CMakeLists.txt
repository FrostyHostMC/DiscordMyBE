cmake_minimum_required(VERSION 3.20)
project(gtav_autoport_native_engine LANGUAGES C CXX)

include(FetchContent)
set(RAGEKIT_BUILD_CLI ON CACHE BOOL "" FORCE)
set(RAGEKIT_BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(RAGEKIT_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(RAGEKIT_BUILD_RENDER OFF CACHE BOOL "" FORCE)

FetchContent_Declare(
  ragekit
  GIT_REPOSITORY https://github.com/RatPrez/ragekit.git
  GIT_TAG v0.3.1
  GIT_SHALLOW TRUE
)
FetchContent_MakeAvailable(ragekit)
