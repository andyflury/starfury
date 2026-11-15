# TX12 setup for StarFury

StarFury reads the Radiomaster TX12 as a USB game controller in Chrome. This note covers the one-time setup on the radio and how to check what it sends. Points marked *to confirm on the device* could not be verified in the EdgeTX manual.

## 1. Plug in and choose joystick mode

Plug the USB-C cable into the TX12 and the laptop with the radio switched on. EdgeTX asks what the USB connection should be; choose the joystick option ("USB Joystick (HID)"; *exact wording of the prompt to confirm on the device*). Windows then sees a generic game controller.

To skip the question every time: in Radio Setup, set **USB Mode** to **Joyst** (the options are **Ask**, **Joyst**, **SDCard** and **Serial**; **Ask** is the default). Source: [EdgeTX manual, Radio Setup (B&W radios)](https://manual.edgetx.org/bw-radios/radio-settings/radio-setup).

The manual recommends turning the internal and external RF modules off for a model used as a USB joystick, so the radio does not transmit to a real model while you play (in the model's Setup page; *exact field names to confirm on the device*).

## 2. Why the switches need mixes (classic joystick mode)

In the default **Classic** joystick mode the radio does not send its sticks and switches directly. It sends the selected model's **output channels**: CH1–CH8 as the eight axes and CH9–CH32 as 24 buttons ([USB Joystick, Model Setup](https://manual.edgetx.org/bw-radios/model-select/setup#usb-joystick), [Joystick Mapping Information for Game Developers](https://manual.edgetx.org/edgetx-how-to/joystick-mapping-information-for-game-developers)). A normal model only puts the four sticks on CH1–CH4, so a switch has to be mixed to a channel to reach the laptop (*that an unmixed switch sends nothing is inferred from the manual, to confirm on the device*). A switch mixed to CH5–CH8 arrives as an axis; a switch mixed to CH9 or higher arrives as a button. StarFury detects the Arm switch either way.

The order of the sticks on CH1–CH4 (AETR, TAER, …) comes from **Def Chan Ord** in Radio Setup when the model is created. It does not matter for StarFury: the setup wizard finds each stick by watching it move.

## 3. Make a "Game" model

Use a separate model so the flying models stay untouched.

1. Press **[MDL]** to open **Model Select**, scroll to an empty slot, press **[Enter]** and choose **Create Model**. Name it `Game` in the model's **Setup** page ([Model Select](https://manual.edgetx.org/bw-radios/model-select)).
2. Open the model's **Mixes** page (*how to get there from Model Setup, usually with the [PAGE] button, to confirm on the device*). The sticks are already on CH1–CH4.
3. Select the empty line of **CH5**, press **[Enter]** to create a mix, and set **Source** to switch **SA** (long-press **[Enter]** on Source to choose from the source categories) ([Mixes](https://manual.edgetx.org/bw-radios/model-select/inputs-mixes-and-outputs/mixes)). Leave Weight at 100 and Offset at 0.
4. Do the same for **SB → CH6**, **SC → CH7** and **SD → CH8**.
5. Turn off the RF modules for this model (see section 1).

Each switch now shows up as an axis that jumps between its end values (−1 and +1, and 0 for the middle of a three-position switch). StarFury handles either. Any of these switches can be the Arm switch; the wizard's drawing shows the top-left one (*whether the TX12's top-left switch is labelled SA to confirm on the device*).

## 4. Alternative: advanced joystick mode

In the model's Setup page, the **USB Joystick** section can be switched from **Classic** to **Advanced** (available since EdgeTX 2.9). There each output channel gets a mode (**None**, **Btn**, **Axis**, **Sim**); a channel set to **Btn** becomes a game-controller button, with **Button Mode** **Normal**, **Pulse**, **SWEmu**, **Delta** or **Companion**. StarFury reads a switch sent as a button too: use **Normal** so the button stays pressed for as long as the switch is in that position. After changing the joystick configuration, apply the changes (the colour-radio manual names an **Apply Changes** entry; *on the TX12 to confirm on the device*) and unplug and replug the USB cable ([USB Joystick](https://manual.edgetx.org/bw-radios/model-select/setup#usb-joystick), [Configure Advanced Joystick](https://manual.edgetx.org/edgetx-how-to/configure-advanced-joystick-with-edgetx)).

The manual says advanced mode is not available on black-and-white radios with less than 1 MB of flash memory. *Whether the TX12 offers it to confirm on the device*; the classic mode with mixes always works.

## 5. Check what the radio sends

Chrome lists the controller only after one of its sticks or switches has moved since the page loaded. Wiggle a stick first.

- **Raw view:** in the project folder run `npm run dev`, then open `http://localhost:5173/dev/input.html` in Chrome (Vite prints the actual address). It shows the controller's name, every axis as a bar with its value and every button as a lamp, and, once the wizard has run, what the game makes of it. Flip each switch: with the Game model, axes 4–7 should jump.
- **Windows:** press Win+R, run `joy.cpl`, select the radio and open **Properties** to see the axes and buttons move.

## 6. Run the controller setup in the game

The wizard runs on the first start. To run it again, press the controller button in the top-left corner of the title screen. It asks for the left stick up and down, the right stick left and right, then up and down, then the Arm switch, and finally shows everything live. On that last screen, Backspace throws the result away and starts again; Escape leaves the setup at any step. The mapping is stored in the browser, so it survives a reload; it is per browser and per site address.
