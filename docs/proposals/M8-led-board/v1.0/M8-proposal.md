# Çılgın Kurye — Module M8: LED Animation and Physical Board

CSE 396 Module Documentation · Gebze Technical University · Group 8 (Board&Byte) · 6 November 2026

Team: Ayşe Poyraz, Hasan Hüseyin Özdemir, Muhib Taha Boy, Umutcan Ocak

The PDF next to this file has the same text with all figures.

## 1. Purpose

M8 builds the physical city board and writes the animation engine that turns the game state into light. The board is 60 × 60 cm. Programmable addressable RGB LED strips lie in all roads and in the four stores, and there are 3D printed buildings and places for the motion sensor and the vibration motors. In the game the board is the only map, so it must be clear to read from every side of the table.

| Runs on | Technology | Requirements |
|---|---|---|
| ESP32 in the LED board, in one Arduino program together with M7, and the board itself for the hardware | C++ animation engine that also runs on a PC for tests, programmable addressable RGB LED strips, an external power supply, 3D printing, a plywood base | R2 R5 R6 R7 R8 R11 |

M8 gets all its data from M7 in the same program and gives light to the LED strips. The figure shows the data on both sides.

## 2. Requirements covered

M8 takes part in six requirements. The last column says what will work when M8 is finished.

| **ID** | **Requirement** | **What M8 does for it** | **When M8 is done** |
|---|---|---|---|
| R2 | Delivery cycle | Delivery points blink in the player's colour, a flash when the package is delivered | Each player finds the own delivery point on the board |
| R5 | No map on the phone | The board is the map with all motorcycles. “Find me” makes the player's dot white for 1 s | A player can always find the own motorcycle |
| R6 | Obstacles | A red pattern for each type on the whole road segment, light blue for a puddle | Every obstacle type is clear from a distance |
| R7 | Earthquake | A shock wave from the earthquake centre | The earthquake is seen on the table |
| R8 | Physical LED board | 60 × 60 cm, 6 roads in each direction, LEDs on all roads, printed buildings, four stores | The finished board stands on the table and shows the game |
| R11 | Engineering requirements | Demo mode without a server, animations checked as images on a PC | M8 can be built and tested without the server |

## 3. Inputs and outputs

The board state comes 10 to 30 times per second, but M8 draws 60 frames per second, so it fills the time between two states by itself.

| **Direction** | **Data** | **From / to** | **Content** |
|---|---|---|---|
| In | Board state | M7 | Phase, players, delivery points, obstacles, earthquake |
| In | Config | M7 | Player colours, brightness from 0.1 to 1, power limit |
| In | Link state | M7 | Connected or searching |
| In | City plan | Shared file | Road grid and store places, turned into the LED map when the code is built |
| Out | Light | LED strips | The colour of every LED, 60 frames per second |
| Out | Frame report | M7 | Frame rate and power estimate, shown to the admin |

## 4. Main components

The engine has five parts. They run one after the other for every frame.

| **Component** | **Takes** | **Gives** |
|---|---|---|
| LED map | City plan | The place of every LED on the roads and in the stores, made by a script |
| Motion smoother | The last two board states | Smooth motorcycle positions along the roads for every frame |
| Layers and effects | Board state, phase, link state | Five layers and the patterns for obstacles, earthquakes and game phases |
| Post processing and output | The mixed frame, config | Corrected colours inside the brightness and power limit, sent to the strips |
| Demo mode | A built in scenario | A full game look without a server |

## 5. How it works

**The board:**

The base is plywood. On it there are 6 roads in each direction, so the city has 5 × 5 blocks. The LED strips lie in the roads between the crossings. There are no LEDs at the crossings, because two strips cannot lie on top of each other. The buildings are 3D printed from the same models as the 3D city on the phone, so a player finds the same building on the board and on the phone. The LEDs need an external power supply, and the software keeps the power under the limit in the config.

**Colours:**

There are four teams and each team has one colour: blue, green, yellow and purple. The two players of a team have a light and a dark tone of the team colour. Red is used only for obstacles, so red always means “this road slows you down”. The pattern of the red tells the type of the obstacle. A water puddle is light blue, because it makes the road slippery, not slow. White is used only for “Find me”, so a player always knows that the white dot is the own motorcycle.

**Layers:**

The engine draws 60 frames per second. Each frame is made from five layers, from the bottom to the top: the roads, the obstacles, the delivery points, the motorcycles and a top layer for short effects. A higher layer covers a lower one, so when two things fall on the same LED, the higher one is shown. When two motorcycles are on the same LED, their colours take turns. After the layers, the engine corrects the colours for the eye, sets the brightness from the config, and lowers all LEDs a little if the frame would need more power than the limit.

**Smooth motion on the roads:**

The board state comes less often than the frames, so the motion smoother moves each motorcycle dot between the last two states. It moves the dot along the roads, through the crossing, and never in a straight line over a block. The dot is drawn one state behind the newest one, so it adds a small delay. If a state is lost, the dot keeps moving along its road with its last speed until the next state comes. The dot has a short tail, so the direction of motion is easy to see.

**Game phases and the link:**

Every game phase has its own look, so the people around the table always know what happens.

In the lobby the roads are dark and the four stores glow in the team colours. In the countdown the light moves from the edge to the centre in three steps, one for each number. During the game the board shows the live state. In a pause everything stays where it is, but all LEDs dim and breathe slowly. At the end all roads turn to the colour of the winner team, and in a draw the colours of the winners take turns. If M7 says that the link is lost, the roads go dark and the stores breathe slowly in a dim white, so everybody can see that the board is waiting.

**Earthquake:**

When an earthquake starts, a ring of light grows from the centre of the earthquake over the whole board, like a wave on water, and slowly fades. The road work after an earthquake is not a decision of M8. M1 puts it into the obstacle list, and M8 only draws it like any other obstacle.

## 6. Testing

M8 is tested alone, without M7 and without the server. The engine is plain C++, so it also runs on a PC with recorded board states as test data. There every animation and every game phase is drawn as an image and compared with a saved reference image. On the real board a built in demo scenario plays a full game without a server, and test patterns check the order and place of the LEDs, the 8 player colours (three people must name each colour correctly), the power limit at full white and the heat in a long run.
