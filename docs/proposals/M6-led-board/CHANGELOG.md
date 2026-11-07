# M6 LED Board and ESP32 — proposal changelog

Members: Tuğberk Akbulut, Hasan Alperen Elmas, Hasan Hüseyin Özdemir, Muhib Taha Boy, Ayşe Poyraz, Umutcan Ocak

## v2.0 — 7 November 2026

The project now has six modules. Joins the old M7 ESP32 Software and Communication ([`M7-esp32-communication/`](https://github.com/cenggroup8/cilgin-kurye/tree/0501c57f2874f9e49267aca2daff76bf8f56db17/docs/proposals/M7-esp32-communication)) and M8 LED Animation and Physical Board ([`M8-led-board/`](https://github.com/cenggroup8/cilgin-kurye/tree/0501c57f2874f9e49267aca2daff76bf8f56db17/docs/proposals/M8-led-board)) into one module with a link part and an LED part.

Approved by: — (in review in issue #17)

## Earlier history

The old folders were removed in v2.0. Their files can still be read at the last commit
of the eight module structure (links above). Their changelogs were:

### Old M7 ESP32 Software and Communication

Members: Tuğberk Akbulut, Hasan Alperen Elmas, Hasan Hüseyin Özdemir, Muhib Taha Boy

#### v1.0 — 6 November 2026

Version for submission: purpose, requirements covered, inputs and outputs, main components,
how it works, testing and demonstration, with drawings of the planned board and screens.

Approved by: the team (issue #13)

#### v0.1 — 1 November 2026

First draft. Board protocol (UDP + MessagePack, message formats, connection rules),
equipment choices, two-core firmware architecture, hit detection and 3 × 3 area,
vibration motors, calibrations C1–C5, tests T1–T11, integration plan and open decisions.

Approved by: — (draft)

### Old M8 LED Animation and Physical Board

Members: Ayşe Poyraz, Hasan Hüseyin Özdemir, Muhib Taha Boy, Umutcan Ocak

#### v1.1 — 7 November 2026

The road work after an earthquake stays on the board until M1 removes it from the obstacle list.

Approved by: the team (issue #14)

#### v1.0 — 6 November 2026

Version for submission: purpose, requirements covered, inputs and outputs, main components,
how it works, testing and demonstration, with drawings of the planned board and screens.

Approved by: the team (issue #14)

#### v0.1 — 1 November 2026

First draft. Board geometry and LED map (344 LEDs, 5 channels), parts list,
power and data wiring, five-layer animation engine, mechanical build,
calibrations L1–L6, tests S1–S7 and H1–H5, integration plan and open decisions.

Approved by: — (draft)
