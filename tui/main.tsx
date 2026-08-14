import {
  createCliRenderer,
} from "@opentui/core";
import {
  useBindings,
  KeymapProvider,
} from "@opentui/keymap/solid";
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui";
import { render, Portal } from "@opentui/solid";

import { createSignal, Show, createEffect } from "solid-js";

const renderer = await createCliRenderer({
  openConsoleOnError: true,
  screenMode: "alternate-screen",
});
const keymap = createDefaultOpenTuiKeymap(renderer);

function App() {
  const [titleVisible, setTitleVisible] = createSignal(false);
  const [prompt, setPrompt] = createSignal("");

  createEffect(() => {
    console.log("Prompt: ", prompt())
  })

  useBindings(() => ({
    commands: [
      {
        name: "quit",
        run() {
          renderer.destroy();
        },
      },
      {
        name: "console",
        run() {
          renderer.console.toggle();
        },
      },
      {
        name: "toggle-title",
        run: () => {
          if (renderer.root.getRenderable("root")?.getRenderable("prompt")?.visible) {
            setTitleVisible(visible => !visible)
          }
        },
      },
    ],
    bindings: [
      // // { key: "q", cmd: "quit" },
      { key: "`", cmd: "console" },
      // { key: "t", cmd: "toggle-title" },
    ],
  }));

  return (
    <box id="root" width={30} height={30} borderColor={"yellow"} >
      <Show when={titleVisible()} >
        <Portal mount={renderer.root}>
          <box position="absolute" bottom={0} height={3} border backgroundColor="#1e1e1e" style={{ flexDirection: "row", justifyContent: "space-between", paddingLeft: 1, paddingRight: 1 }}>
              <text>agent-cody-banks </text>
          </box>
        </Portal>
      </Show>
      <text id="rich">
        <strong>Important:</strong>{" "}
        <span style={{ fg: "red" }}>
          <u>Warning!</u>
        </span>{" "}
        Normal text
      </text>
      <input id="prompt" placeholder="Enter your prompt..." width={25} focused={true} value={prompt()} onInput={(e) => setPrompt(e)} />
    </box>
  );
}

await render(
  () => (
    <KeymapProvider keymap={keymap}>
      <App />
    </KeymapProvider>
  ),
  renderer,
);
