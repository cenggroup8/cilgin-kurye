# M6-1 Link part

Finds the server, keeps one TCP channel and one UDP stream, and hands the newest
full state and the config to the LED part. Protocol: [`contracts/board_protocol.md`](../../../../contracts/board_protocol.md).

| File | What |
|---|---|
| `msgpack.h/.cpp` | Small MessagePack reader and writer. Gives the same bytes as the server |
| `protocol.h/.cpp` | Frame check, content of `S`, `C`, `V`, encoding of `H`, `Q`, `N`, `T`, `O`, `A`, TCP length |
| `link_types.h` | Data between the parts of the board program (plan #28, section 3.2) |
| `net.h` | The network as the link sees it; nothing waits |
| `net_arduino.h` | Wi-Fi on the ESP32 |
| `link.h/.cpp` | Search, connect, session number, order numbers, answers, state hand over, searching again |

Plain C++17. Only `net_arduino.h` and `../main.cpp` use Arduino headers, so the rest
runs in the PC tests.

## Build and load onto the board

[PlatformIO](https://platformio.org/) in `M6-led-board/firmware/`:

```
cp include/secrets.example.h include/secrets.h   # Wi-Fi name, password, backup server
pio run -t upload
pio device monitor
```

## PC tests

A C++ compiler and `make` (Linux, macOS, or MSYS2 on Windows):

```
cd M6-led-board/firmware/test/link
make test     # codec with the contract vectors, bad input, and the link against a simulated server
make itest    # the link on real sockets against the real M2-4 server (needs M2-network and npm install there)
```

## How it behaves

| Case | What the board does |
|---|---|
| Start | Hello as a UDP broadcast once per second. After 5 s also to the backup address |
| Answer | The server's delay probe gives its address; the board opens TCP and sends Hello |
| Config, vibrate | Answered at once with `A` (`of` names the type); a repeated `seq` is answered but used once |
| Board state | The newest is kept; a late or repeated UDP packet is dropped |
| New session number | The order numbers start again, so the new server's states are taken |
| Delay probe | Answered at once with the state in use and its age |
| Earthquake event | Sent on TCP, again every second until the server answers |
| No state for 1 s, Wi-Fi down, channel closed | "Searching" at once (the motors stop), then the search starts again |
| Broken message | Counted and dropped; a TCP length over 2048 bytes closes the channel |
