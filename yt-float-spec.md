# YT Float: Spec

A small macOS desktop app that shows YouTube in a floating, always-on-top window, signed in to my own account. Personal use only, not distributed.

## Platform
- macOS only (runs on my machine)
- Electron + plain JavaScript, no frontend framework
- Unsigned build, so no Apple Developer account needed

## Window
- Frameless, always on top, including over full-screen apps
- Visible on all Spaces/desktops
- Resizable from edges and corners, with a minimum size of about 320×180
- Keeps a 16:9 aspect ratio by default (toggleable)
- Remembers its last position and size between launches
- Slightly rounded corners and a subtle shadow

## Dragging
- A thin drag bar (about 24px) across the top that only appears on hover
- Dragging the bar moves the window; everything else stays clickable so YouTube controls work
- The drag bar holds three small buttons: Back, Home (youtube.com), Close

## YouTube and account
- Loads https://www.youtube.com
- Uses a persistent session so I sign in once and stay signed in
- Identifies itself as regular desktop Chrome to avoid Google's "browser not secure" sign-in block
- Fallback if sign-in is still blocked: a menu item that opens Google sign-in in a separate normal window sharing the same session

## Controls
| Shortcut | Action |
|---|---|
| ⌥⌘Y (global) | Show / hide the window |
| ⌥⌘T | Toggle always-on-top |
| ⌥⌘↑ / ⌥⌘↓ | Opacity up / down (40–100%) |
| ⌥⌘C | Compact mode: hide YouTube's header and sidebar and show mostly the player |

- Menu bar (tray) icon with Show/Hide, Compact mode, Reset window position, and Quit
- No Dock icon (optional setting)

## Packaging
- `npm start` runs it in development
- `npm run build` produces an unsigned `YT Float.app` (via electron-builder) to drag into Applications
- If macOS warns on first launch: right-click the app and choose Open, once

## Out of scope
- Ad blocking, downloading videos, multiple windows, Windows/Linux builds, auto-updates

## Known risk
- Google may still block sign-in inside embedded browsers at times. The fallback above covers this.
