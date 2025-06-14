# osu-reverse-mapper

This is a browser-based tool that lets you create an osu! map and matching replay by simply moving your cursor and clicking. You can spam circles and try to break the pp record like I did in my video, or you can just make cool cursor dancing replays, or whatever else.

## Features

- Hitcircle mapping based on real-time cursor position and clicks
- Live visualization of hit circles as you play
- Replay generation using recorded input data
- Load your own skin and beatmap
- Edge mode to place circles offset from the cursor center
- Snapping and mod options

## How it works

This tool records your mouse position and key presses, then writes a valid `.osz` map file and `.osr` replay file.

## Try it

You can run the tool directly in your browser [here](https://andrewli336.github.io/osu-reverse-mapper/).

## Development

Built with:

- HTML
- CSS
- JavaScript

You can view and modify it to customize how circles are placed, how inputs are recorded, or how the map is generated.

## License

This project is open-source. See the [LICENSE](LICENSE) file for more details.
