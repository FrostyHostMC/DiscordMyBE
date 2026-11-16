TITLE := Project V PS4 Manager
VERSION := 01.10
TITLE_ID := AUPT00001
CONTENT_ID := IV0000-AUPT00001_00-AUTOPORTPS400000
TOOLCHAIN := $(OO_PS4_TOOLCHAIN)
PKGDIR := $(TOOLCHAIN)/bin/linux
INTDIR := build
CORE_LIBS := -lc -lkernel -lc++ -lSceLibcInternal -lSceVideoOut -lScePad
ALL_STUBS := $(sort $(patsubst $(TOOLCHAIN)/lib/lib%.so,-l%,$(wildcard $(TOOLCHAIN)/lib/lib*.so)) $(patsubst $(TOOLCHAIN)/lib/lib%.a,-l%,$(wildcard $(TOOLCHAIN)/lib/lib*.a)))
EXTRA_LIBS := $(filter-out $(CORE_LIBS),$(ALL_STUBS))
LDFLAGS := -m elf_x86_64 -pie --script $(TOOLCHAIN)/link.x --eh-frame-hdr -L$(TOOLCHAIN)/lib $(CORE_LIBS) --as-needed $(EXTRA_LIBS) --no-as-needed $(TOOLCHAIN)/lib/crt1.o
CFLAGS := --target=x86_64-pc-freebsd12-elf -fPIC -funwind-tables -c -O2 -isysroot $(TOOLCHAIN) -isystem $(TOOLCHAIN)/include
CXXFLAGS := $(CFLAGS) -isystem $(TOOLCHAIN)/include/c++/v1
SOURCES := src/main.cpp src/platform/graphics.cpp src/platform/library.cpp src/platform/goldhen_config.cpp src/platform/compatibility_profiles.cpp
OBJECTS := $(patsubst src/%.cpp,$(INTDIR)/%.o,$(SOURCES))
FILES := eboot.bin sce_sys/param.sfo sce_sys/icon0.png $(wildcard sce_sys/about/*) $(wildcard sce_module/*) $(shell find assets -type f 2>/dev/null)

ifeq ($(strip $(TOOLCHAIN)),)
$(error OO_PS4_TOOLCHAIN must point to the extracted OpenOrbis PS4 toolchain)
endif

.PHONY: all clean check-toolchain
all: check-toolchain $(CONTENT_ID).pkg

check-toolchain:
	@test -x "$(PKGDIR)/create-fself" || (echo "Missing OpenOrbis create-fself"; exit 1)
	@test -x "$(PKGDIR)/create-gp4" || (echo "Missing OpenOrbis create-gp4"; exit 1)
	@test -x "$(PKGDIR)/PkgTool.Core" || (echo "Missing OpenOrbis PkgTool.Core"; exit 1)
	@test -f "$(TOOLCHAIN)/link.x" || (echo "Missing OpenOrbis link.x"; exit 1)

$(INTDIR)/%.o: src/%.cpp
	mkdir -p $(dir $@)
	clang++ $(CXXFLAGS) -Isrc/platform -o $@ $<

eboot.bin: $(OBJECTS)
	mkdir -p $(INTDIR)
	ld.lld $(OBJECTS) -o $(INTDIR)/autoport.elf $(LDFLAGS)
	$(PKGDIR)/create-fself -in=$(INTDIR)/autoport.elf -out=$(INTDIR)/autoport.oelf --eboot "eboot.bin" --paid 0x3800000000000011

sce_sys/param.sfo: Makefile
	mkdir -p sce_sys
	$(PKGDIR)/PkgTool.Core sfo_new $@
	$(PKGDIR)/PkgTool.Core sfo_setentry $@ APP_TYPE --type Integer --maxsize 4 --value 1
	$(PKGDIR)/PkgTool.Core sfo_setentry $@ APP_VER --type Utf8 --maxsize 8 --value '$(VERSION)'
	$(PKGDIR)/PkgTool.Core sfo_setentry $@ ATTRIBUTE --type Integer --maxsize 4 --value 0
	$(PKGDIR)/PkgTool.Core sfo_setentry $@ CATEGORY --type Utf8 --maxsize 4 --value 'gd'
	$(PKGDIR)/PkgTool.Core sfo_setentry $@ CONTENT_ID --type Utf8 --maxsize 48 --value '$(CONTENT_ID)'
	$(PKGDIR)/PkgTool.Core sfo_setentry $@ DOWNLOAD_DATA_SIZE --type Integer --maxsize 4 --value 0
	$(PKGDIR)/PkgTool.Core sfo_setentry $@ SYSTEM_VER --type Integer --maxsize 4 --value 0
	$(PKGDIR)/PkgTool.Core sfo_setentry $@ TITLE --type Utf8 --maxsize 128 --value '$(TITLE)'
	$(PKGDIR)/PkgTool.Core sfo_setentry $@ TITLE_ID --type Utf8 --maxsize 12 --value '$(TITLE_ID)'
	$(PKGDIR)/PkgTool.Core sfo_setentry $@ VERSION --type Utf8 --maxsize 8 --value '$(VERSION)'

pkg.gp4: $(FILES) Makefile
	$(PKGDIR)/create-gp4 -out $@ --content-id=$(CONTENT_ID) --files "$(FILES)"

$(CONTENT_ID).pkg: pkg.gp4
	$(PKGDIR)/PkgTool.Core pkg_build $< .

clean:
	rm -rf $(INTDIR) eboot.bin pkg.gp4 sce_sys/param.sfo *.pkg SHA256SUMS.txt
