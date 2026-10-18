DROP FOLDER: extra footage for the bmintx.com hero mashup
(Everything in this folder except this README is gitignored.)

WHAT TO DROP
- Video clips (.mp4/.mov), ideally 5-10 s, any size or aspect. 16:9 and 9:16 both work.
- Only work we own, or that its creator made and published on our platforms as their own.
  No mirrored tweets / X videos, no third-party characters or brands (Peppa, Care Bears, etc.).
- Name the file after the creator if known, e.g. vexvoid-neon-run.mp4, so the chip can say "by $vexvoid".
- Optional music: a VexVoid track we own (.mp3). The current cut uses
  VexVoid/vexvoid.com-website/.cache/audio/VEX_MUSIC_SHATTERED_CIRCUITS.mp3 from 0:44.74.

HOW TO RE-RENDER (needs ffmpeg, python3 with numpy + Pillow, Bebas Neue in ~/Library/Fonts)
  cd /Volumes/2026/Projects/bmintx-site/media-src/tools
  1. Edit mkedl.py: add a segment such as
       dict(srcs=[[INC+'vexvoid-neon-run.mp4', 1.0]], beats=2, fx=['punch','rgb'],
            seal=1, chip=chip('$vexvoid'), words=['*NEW'], size=200, wy=0.12)
     beats = length on the 152 BPM grid (1 beat = 0.395 s). fx: punch, whip, rgb, glitch, leak, flash, dim.
     layout='tri' with 3 srcs = triptych (16:9 only). '*WORD' = gold word.
     (The NPGX storage clips need downloading into work/dl/ first. See the comment at the top of mkedl.py.)
  2. python3 mkedl.py                       -> work/edl.json (prints the length in seconds)
  3. python3 comp.py work/edl.json 1920 1080 work/raw169.mp4
     python3 comp.py work/edl.json 1080 1920 work/raw916.mp4
  4. Check frames: python3 stills.py work/raw169.mp4 work/check.jpg 5 1,3,5,8,12,16,20,24
  5. Encode (see the ffmpeg lines in the git log of commit b653be9, or:)
     muted hero  : ffmpeg -i work/raw169.mp4 -an -c:v libx264 -preset slower -b:v 2100k -maxrate 3500k -bufsize 8M -pix_fmt yuv420p -movflags +faststart ../../media/hero-mashup.mp4
     with sound  : add  -ss 44.74 -t <len> -i <track.mp3> -map 0:v -map 1:a -c:a aac -b:a 160k -shortest
     vertical    : same as "with sound" from work/raw916.mp4 -> ../../media/hero-mashup-vertical.mp4
  6. Update ../../media/hero-credits.txt with each new clip's source path.

beat.py <track.mp3> prints the BPM, the beat phase and the loudest 32 s window, for picking a new track.
