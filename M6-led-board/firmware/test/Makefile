# PC tests for the M6 firmware parts that do not need the hardware.
#   make test    build and run
#   make clean
CXX ?= c++
CXXFLAGS ?= -std=c++17 -O2 -Wall -Wextra -Wpedantic

QUAKE_SRC = ../src/quake/hit_detector.cpp ../src/quake/motor_controller.cpp ../src/quake/calibration.cpp ../src/quake/motor_shield.cpp ../src/quake/mpu6050.cpp
QUAKE_HDR = $(wildcard ../src/quake/*.h) sim_board.h

test: build/test_quake
	./build/test_quake

build/test_quake: test_quake.cpp $(QUAKE_SRC) $(QUAKE_HDR)
	@mkdir -p build
	$(CXX) $(CXXFLAGS) -o $@ test_quake.cpp $(QUAKE_SRC)

clean:
	rm -rf build

.PHONY: test clean
