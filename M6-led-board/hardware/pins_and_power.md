# Pin table and power of the LED board (draft)

Which wire of each part goes to which pin of the ESP32, and how the power gets from
the power supply to the LEDs, the ESP32 and the motors. Part of M6-5 (#56), plan #28
section 3.4. Written for the parts that were bought (photos and the order of 24 Nov);
where a part differs from #20 it says so.

The order of the LED strip pieces is in [`strip_layout.md`](strip_layout.md).

## Parts

| Part | What was bought | Note |
|---|---|---|
| Controller | ESP32-WROOM-32D development board, **38 pins**, CP2102 USB, micro USB | fits `board = esp32dev` of the firmware (M6-1) |
| Motion sensor | MPU-6050 on a GY-521 board (2 bought) | I2C address 0x68 |
| LED strip | WS2812B, 144 LEDs/m, 12 mm wide, 2 × 5 m | 788 LEDs used on the 65 cm base, see `strip_layout.md` |
| Level shifter | 2 × 4 channel 3.3 V ↔ 5 V logic level converter | instead of the 74HCT245 of #20, see "LED data" below |
| Motor driver | motor shield for Arduino: 2 × L293D and a 74HC595 (the common "motor shield v1" design) | instead of one MOSFET per motor in #20 |
| Motors | 4 × 3–6 V DC motor | no spare |
| Power supply | **S-5V40A: 5 V, 40 A** (200 W), mains input L, N, earth | instead of the two adapters of #20 |
| Other | 1N4007 diodes, jumper wires (male-female, male-male), step-down converters (LM2596 3 A, 2 × 2 A) | the step-down converters are not needed: everything runs on 5 V |

## Pin table

ESP32 pins that are **not used**: 6–11 (CLK, D0–D3, CMD: the flash memory), 34, 35, VP (36),
VN (39) (input only), 0, 2, 12, 15 (they decide how the board starts), TX and RX (USB).

| ESP32 pin | Goes to | Through | Used by |
|---|---|---|---|
| GPIO16 | LED chain A, DIN of the first piece (store 0) | level shifter 1, channel 1, then 330 Ω | M6-3 |
| GPIO17 | LED chain B, DIN of the first piece (`v_0_0`) | level shifter 1, channel 2, then 330 Ω | M6-3 |
| GPIO21 | MPU-6050 SDA | direct | M6-2 |
| GPIO22 | MPU-6050 SCL | direct | M6-2 |
| GPIO32 | shield pin **11**: speed of motor M1 | direct | M6-2 |
| GPIO33 | shield pin **3**: speed of motor M2 | direct | M6-2 |
| GPIO25 | shield pin **6**: speed of motor M3 | direct | M6-2 |
| GPIO26 | shield pin **5**: speed of motor M4 | direct | M6-2 |
| GPIO27 | shield pin **12**: latch of the 74HC595 | level shifter 1, channel 3 | M6-2 |
| GPIO14 | shield pin **4**: clock of the 74HC595 | level shifter 1, channel 4 | M6-2 |
| GPIO13 | shield pin **8**: data of the 74HC595 | level shifter 2, channel 1 | M6-2 |
| 3V3 | MPU-6050 VCC, low side (LV) of both level shifters | | |
| GND | MPU-6050 GND, both level shifters, shield GND, power ground | | |
| 5V | power supply 5 V (fuse F3), see "ESP32 and USB" | | |

Free for later: GPIO4, 18, 19, 23 (and GPIO5, which is also a start pin but is fine as an
output) and level shifter 2, channels 2–4.

Shield pin **7** (enable of the 74HC595) goes to **GND**: then the 74HC595 outputs are
always on, and one ESP32 pin is saved. The shield numbers are the Arduino pin numbers printed
on the shield; the shield does not plug onto the ESP32, it is joined with male-female jumper
wires to the pins under the shield.

### Motors

| Shield output | Motor | Zone | Mask bit in `V` |
|---|---|---|---|
| M1 | north-west corner | 0 | bit 0 |
| M2 | north-east corner | 2 | bit 1 |
| M3 | south-west corner | 6 | bit 2 |
| M4 | south-east corner | 8 | bit 3 |

How the shield is driven (for M6-2): each L293D channel has a speed pin (the table above,
PWM from the ESP32, for example 1 kHz with `ledcWrite`) and two direction inputs set by the
74HC595. A vibration motor does not need a direction, so at start the program sends one byte
to the 74HC595 that sets all four motors to "forward" and never changes it:

```cpp
// 74HC595 bits of the motor shield v1: M1 A=2 B=3, M2 A=1 B=4, M3 A=5 B=7, M4 A=0 B=6.
// Forward = A on, B off: bits 2, 1, 5, 0 -> 0x27. Sent most significant bit first.
void motorShieldForward() {
  const uint8_t bits = 0x27;
  digitalWrite(PIN_SR_LATCH, LOW);
  for (int i = 7; i >= 0; i--) {
    digitalWrite(PIN_SR_CLOCK, LOW);
    digitalWrite(PIN_SR_DATA, (bits >> i) & 1);
    digitalWrite(PIN_SR_CLOCK, HIGH);
  }
  digitalWrite(PIN_SR_LATCH, HIGH);
}
```

After that, the strength of a motor is only the PWM duty on its speed pin (0 = off). This fits
the motor controller of #60, which already drives each motor with its own duty. The L293D
loses about 1.5–2 V, so on 5 V a motor gets about 3–3.5 V; that should be enough to shake the
board, check it on the first test.

### LED data

The strips need a 5 V data signal; the ESP32 gives 3.3 V. The bought level shifters are the
small MOSFET type, which is fine for the slow 74HC595 lines but may be too slow for the
800 kHz WS2812B signal. Test order on the first setup:

1. Through the level shifter, as in the table.
2. If the LEDs flicker or show wrong colours: GPIO straight to DIN through the 330 Ω resistor
   (many WS2812B strips take 3.3 V data when the first wire is short).
3. If that is not stable either: a 74AHCT125 or 74HCT245 chip (a few lira) for the two data lines.

### Proposed constants for the firmware

```cpp
// M6-led-board/hardware/pins_and_power.md
constexpr int PIN_LED_A    = 16;  // chain A: east-west roads and stores (398 LEDs)
constexpr int PIN_LED_B    = 17;  // chain B: north-south roads (390 LEDs)
constexpr int PIN_IMU_SDA  = 21;
constexpr int PIN_IMU_SCL  = 22;
constexpr int PIN_MOTOR[4] = {32, 33, 25, 26};  // M1..M4 = zone 0, 2, 6, 8 = mask bit 0..3
constexpr int PIN_SR_LATCH = 27;  // shield pin 12
constexpr int PIN_SR_CLOCK = 14;  // shield pin 4
constexpr int PIN_SR_DATA  = 13;  // shield pin 8 (shield pin 7 to GND)
```

## Power

```
 mains 220 V ── [plug with earth] ── L / N / ⏚ of the power supply S-5V40A
                                              │
                                     V+ (5 V)  ┴  V− (ground)
                                       │            │
         ┌────────────┬────────────────┤            ├── common ground of everything:
         │            │                │            │   strips, ESP32, shield, sensor,
     [F1 10 A]    [F2 10 A]        [F3 3 A]         │   level shifters
         │            │                │            │
    5 V bus A     5 V bus B        ┌───┴──────────┐ │
   (18 AWG)       (18 AWG)         │              │ │
     │  1000 µF     │  1000 µF   shield:        ESP32 5V pin
     │              │            EXT-PWR +M     (3V3 pin → sensor
  start of each  start of each   and 5V pin      and level shifters LV)
  row of chain A column of B     (jumper PWRJMP
  (6 feeds)      (6 feeds)        removed)
```

| Rule | Why |
|---|---|
| **Mains side (L, N, earth) is 220 V.** It is wired by someone who has done mains wiring before, with a cable that has a plug and an earth wire. Never touch the screws while the plug is in. Cover the screw side. | danger to life |
| Set the output with the ADJ screw to 5.0–5.1 V, measured with a multimeter | WS2812B and the ESP32 want 5 V |
| A fuse on each 5 V branch: F1 10 A (chain A), F2 10 A (chain B), F3 3 A (shield and ESP32) | 40 A can melt a thin wire before the supply stops; a fuse makes a short safe |
| Main 5 V and ground wires 18 AWG; from the bus to each feed point 22 AWG | the jumper wires that were bought are for signals only |
| Power goes in at the start of **every row** of chain A and **every column** of chain B (12 feed points), 5 V and ground from the bus. Inside a row the pieces are joined by 3-wire jumpers | a 144 LEDs/m strip has thin copper; one row is 65 LEDs |
| A 1000 µF capacitor between 5 V and ground at the start of each bus | the first LEDs do not get a voltage jump at power on |
| All grounds together: power supply V−, ESP32 GND, shield GND, sensor GND, both sides of the level shifters | without a common ground the data signal has no reference |
| Remove the shield jumper **PWRJMP** | it would join the motor power with the shield logic power in a way we do not use |
| Power limit in the config: `max_ma` = **8000** (8 A for all LEDs) | about 4 A per chain, far under the 10 A fuses; the LED part (M6-3) lowers the brightness when a frame would need more |

Full white on all 788 LEDs would be about 47 A; with the power limit the board never draws that.
The supply (40 A) has a large margin for the ESP32 (about 0.25 A) and the motors (4 × about
0.3 A).

### ESP32 and USB

- While programming and testing on the desk: power the ESP32 **from USB only**; join only its
  GND to the power ground.
- On the finished board: 5 V from fuse F3 to the 5V pin of the ESP32.
- **Never both at once:** before plugging the USB cable into a board that gets 5 V from the
  supply, take the 5 V wire off the ESP32 (GND can stay). Otherwise the supply may push current
  into the computer's USB port.

## First test setup (#56: "tek şerit, bir ESP32 ve harici güç")

1. ESP32 on USB alone: load a small program, see it in the serial monitor.
2. One piece of 13 LEDs: 5 V and ground from the supply (through a fuse), ground also to the
   ESP32 GND, data from GPIO16 through the level shifter. Light the LEDs one by one and in red,
   green, blue (test the order and the colours).
3. MPU-6050: 3V3, GND, SDA 21, SCL 22. An I2C scan must find 0x68; a tap on the table must make
   the values jump.
4. Shield: 5 V to its 5V pin and to EXT-PWR +M, PWRJMP removed, the 7 signal wires and pin 7 to
   GND as in the table, one motor on M1. Send `0x27` to the 74HC595, then raise the duty on GPIO32
   slowly.

The other M6 packages test their code on this setup (#28).

## Still missing

Not in the order of 24 Nov, needed for the board:

| Part | How many | For |
|---|---|---|
| Fuse holder (inline or 5 × 20 mm) and fuses 10 A, 10 A, 3 A (and spares) | 3 | the three 5 V branches |
| Silicone wire 18 AWG, red and black | about 3 m each | the 5 V buses |
| Wire 22 AWG, red and black | about 5 m each | feed points and jumpers between pieces |
| Capacitor 1000 µF, 10 V or more | 2 | start of each bus |
| Resistor 330 Ω | 2 | data lines |
| Mains cable with plug and earth | 1 | the power supply |
| Terminal blocks or lever connectors, heat shrink | some | joining the bus wires |
| (only if needed) 74AHCT125 or 74HCT245 | 1 | LED data, if the level shifter is too slow |

## Open points

- The motor strength on about 3–3.5 V: check on the first test. If it is too weak, the motors can
  get their own supply on EXT-PWR (up to 25 V on the L293D) or MOSFETs as in #20.
- The level shifter on the LED data: see "LED data".
- `max_ma` 8000 is a proposal; the real current is measured on the finished board (M6-3 test).
