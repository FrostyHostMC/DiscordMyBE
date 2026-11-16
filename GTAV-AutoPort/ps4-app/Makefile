TITLE := Project V PS4 Manager
VERSION := 01.12
TITLE_ID := AUPT00001
CONTENT_ID := IV0000-AUPT00001_00-AUTOPORTPS400000

TOOLCHAIN := $(OO_PS4_TOOLCHAIN)
TOOLBIN := $(TOOLCHAIN)/bin/linux
INTDIR := build
CC := clang
CXX := clang++
LD := ld.lld
LIBS := -lc -lkernel -lc++ -lSceLibcInternal -lSceVideoOut -lScePad
CFLAGS := --target=x86_64-pc-freebsd12-elf -fPIC -funwind-tables -c -O2 -isysroot $(TOOLCHAIN) -isystem $(TOOLCHAIN)/include
CXXFLAGS := $(CFLAGS) -isystem $(TOOLCHAIN)/include/c++/v1
LDFLAGS := -m elf_x86_64 -pie --script $(TOOLCHAIN)/link.x --eh-frame-hdr -L$(TOOLCHAIN)/lib $(LIBS) $(TOOLCHAIN)/lib/crt1.o

SOURCES := src/main.cpp src/platform/graphics.cpp src/platform/library.cpp src/platform/goldhen_config.cpp src/platform/compatibility_profiles.cpp
OBJECTS := $(patsubst src/%.cpp,$(INTDIR)/%.o,$(SOURCES))
PKG_FILES := eboot.bin sce_sys/param.sfo sce_sys/icon0.png $(shell find sce_sys/about sce_module assets -type f 2>/dev/null | sort)

ifeq ($(strip $(TOOLCHAIN)),)
$(error OO_PS4_TOOLCHAIN must point to the extracted OpenOrbis PS4 toolchain)
endif

.PHONY: all clean check-toolchain
all: check-toolchain $(CONTENT_ID).pkg

check-toolchain:
	@test -x "$(TOOLBIN)/create-fself" || (echo "Missing OpenOrbis create-fself"; exit 1)
	@test -x "$(TOOLBIN)/create-gp4" || (echo "Missing OpenOrbis create-gp4"; exit 1)
	@test -x "$(TOOLBIN)/PkgTool.Core" || (echo "Missing OpenOrbis PkgTool.Core"; exit 1)
	@test -f "$(TOOLCHAIN)/link.x" || (echo "Missing OpenOrbis link.x"; exit 1)

$(INTDIR)/%.o: src/%.cpp
	mkdir -p $(dir $@)
	$(CXX) $(CXXFLAGS) -Isrc/platform -o $@ $<

eboot.bin: $(OBJECTS)
	mkdir -p $(INTDIR)
	$(LD) $(OBJECTS) -o $(INTDIR)/autoport.elf $(LDFLAGS)
	$(TOOLBIN)/create-fself -in=$(INTDIR)/autoport.elf -out=$(INTDIR)/autoport.oelf --eboot "eboot.bin" --ptype=fake --paid 0x3800000000000011
	@test -s eboot.bin

sce_sys/param.sfo: Makefile
	mkdir -p sce_sys
	$(TOOLBIN)/PkgTool.Core sfo_new $@
	$(TOOLBIN)/PkgTool.Core sfo_setentry $@ APP_TYPE --type Integer --maxsize 4 --value 1
	$(TOOLBIN)/PkgTool.Core sfo_setentry $@ APP_VER --type Utf8 --maxsize 8 --value '$(VERSION)'
	$(TOOLBIN)/PkgTool.Core sfo_setentry $@ ATTRIBUTE --type Integer --maxsize 4 --value 0
	$(TOOLBIN)/PkgTool.Core sfo_setentry $@ CATEGORY --type Utf8 --maxsize 4 --value 'gd'
	$(TOOLBIN)/PkgTool.Core sfo_setentry $@ CONTENT_ID --type Utf8 --maxsize 48 --value '$(CONTENT_ID)'
	$(TOOLBIN)/PkgTool.Core sfo_setentry $@ DOWNLOAD_DATA_SIZE --type Integer --maxsize 4 --value 0
	$(TOOLBIN)/PkgTool.Core sfo_setentry $@ SYSTEM_VER --type Integer --maxsize 4 --value 0
	$(TOOLBIN)/PkgTool.Core sfo_setentry $@ TITLE --type Utf8 --maxsize 128 --value '$(TITLE)'
	$(TOOLBIN)/PkgTool.Core sfo_setentry $@ TITLE_ID --type Utf8 --maxsize 12 --value '$(TITLE_ID)'
	$(TOOLBIN)/PkgTool.Core sfo_setentry $@ VERSION --type Utf8 --maxsize 8 --value '$(VERSION)'

pkg.gp4: $(PKG_FILES) Makefile
	$(TOOLBIN)/create-gp4 -out $@ --content-id=$(CONTENT_ID) --files "$(PKG_FILES)"

$(CONTENT_ID).pkg: pkg.gp4
	$(TOOLBIN)/PkgTool.Core pkg_build $< .

clean:
	rm -rf $(INTDIR) eboot.bin pkg.gp4 sce_sys/param.sfo *.pkg SHA256SUMS.txt
