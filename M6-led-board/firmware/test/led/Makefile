# PC tests for the LED output part (M6-3). Run from this folder:
#   make test    build and run
#   make clean
# The LED map header is made by tools/make_led_map/make-led-map.mjs; `make map` checks
# that it is up to date with the city plan and the strip layout (needs Node.js).
CXX ?= c++
CXXFLAGS ?= -std=c++17 -O2 -Wall -Wextra -Wpedantic

LED_SRC = ../../src/led/led_map.cpp ../../src/led/post_process.cpp ../../src/led/test_pattern.cpp \
          ../../src/led/output_stage.cpp ../../src/sys/settings.cpp
LED_HDR = $(wildcard ../../src/led/*.h) $(wildcard ../../src/sys/*.h)

test: build/test_led
	./build/test_led

build/test_led: test_led.cpp $(LED_SRC) $(LED_HDR)
	@mkdir -p build
	$(CXX) $(CXXFLAGS) -o $@ test_led.cpp $(LED_SRC)

map:
	node ../../../../tools/make_led_map/make-led-map.mjs --check

clean:
	rm -rf build

.PHONY: test map clean
