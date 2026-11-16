#pragma once
#include <stdint.h>
#include <orbis/libkernel.h>
#include <orbis/VideoOut.h>
struct Color{uint8_t r,g,b;};
class Scene2D{int width,height,video,frameSize,active;off_t directOff;size_t directSize;uintptr_t memSP;void*mem;char**buffers;OrbisKernelEqueue queue;OrbisVideoOutBufferAttribute attr;bool initQueue();bool allocVideo(size_t,int);bool allocBuffers(int);char*allocDisplay(size_t);public:Scene2D(int,int,int);bool Init(size_t,int);void SubmitFlip(int);void FrameWait(int);void FrameBufferSwap();void FrameBufferFill(Color);void DrawPixel(int,int,Color);void DrawRectangle(int,int,int,int,Color);void SetActiveFrameBuffer(int);};
