# PC tests for the link part (M6-1). Run from this folder:
#   make test    build and run
#   make clean
CXX ?= c++
CXXFLAGS ?= -std=c++17 -O2 -Wall -Wextra -Wpedantic

LINK_SRC = ../../src/link/msgpack.cpp ../../src/link/protocol.cpp ../../src/link/link.cpp
LINK_HDR = $(wildcard ../../src/link/*.h) sim.h

test: build/test_link
	./build/test_link

build/test_link: test_link.cpp $(LINK_SRC) $(LINK_HDR)
	@mkdir -p build
	$(CXX) $(CXXFLAGS) -o $@ test_link.cpp $(LINK_SRC)

# The board part on real sockets against the real M2-4 server (needs Node.js and
# M2-network with its packages: cd ../../../../M2-network && npm install).
ifeq ($(OS),Windows_NT)
SOCKET_LIBS = -lws2_32
endif

M2 = ../../../../M2-network

itest: build/itest_board
	cd $(M2) && npx tsx $(CURDIR)/itest_server.mjs

build/itest_board: itest_board.cpp net_socket.h $(LINK_SRC) $(LINK_HDR)
	@mkdir -p build
	$(CXX) $(CXXFLAGS) -o $@ itest_board.cpp $(LINK_SRC) $(SOCKET_LIBS)

clean:
	rm -rf build

.PHONY: test itest clean
