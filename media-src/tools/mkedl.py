# Edit list for the bMintX hero mashup. Writes work/edl.json for comp.py.
# Storage clips (D) come from https://auth.bmovies.app/storage/v1/object/public/bmovies-assets/skins/... saved as skins_<name>.mp4 in work/dl/.
# Footage dropped in ../incoming/ can be referenced via INC+'file.mp4'.
import json, os
HERE=os.path.dirname(os.path.abspath(__file__)); os.makedirs(os.path.join(HERE,'work','dl'),exist_ok=True)
P='/Volumes/2026/Projects/'; D=os.path.join(HERE,'work','dl')+'/'; INC=os.path.join(HERE,'..','incoming')+'/'
VX=P+'VexVoid/vexvoid.com-website/public/video/grok-video-'
v9=VX+'66236bcb-12bb-4eec-9a7c-8eed664f24e8.mp4'; v12=VX+'6b81d911-56e0-4183-8d45-fd5ba773f4c9.mp4'; v15=VX+'981923fa-e09c-46b8-b6fa-6fbb5cd5c395.mp4'; v18=VX+'badbe081-ff4d-4560-a0ef-2a28baea1de4.mp4'
N=P+'ninja-punk-girls-com/hero-videos/'
Y=P+'npgx/NPGX Yellow/grok-video-'
y39=Y+'11560340-5014-4fca-ad14-e634974a0a1c.mp4'; y46=Y+'a1415f1d-877e-475b-a6d0-e5a23eb565b8.mp4'; y49=Y+'f6404bff-5578-4a24-856e-12d9895e0555.mp4'
hf=P+'bmovies-app.OLD-2026-07-26/hyperflix-idents/grok-video-c9bfe962-3e04-4a70-ad96-412ddc8d10dc.mp4'
bt=P+'bmovies-hyperflix/bmovies-token/'; sf=P+'bmovies/silverfish.mp4'
m=lambda n:D+'skins_npgx-mv-'+n+'.mp4'
TS='18 OCT 2026'
def chip(who): return f'minted · by {who} · {TS} · example'
S=[
 dict(srcs=[[v9,1.0]],beats=4,fx=['flash','punch'],words=['EVERY','THING','*YOU','MAKE'],size=210,wy=0.12),
 dict(srcs=[[v18,1.5]],beats=2,fx=['rgb','punch']),
 dict(srcs=[[v12,2.0]],beats=2,fx=['whip'],seal=1,chip=chip('$vexvoid'),words=['*VEXVOID'],size=150,wy=0.1),
 dict(layout='tri',srcs=[[N+'1.mp4',1],[N+'2.mp4',1],[N+'3.mp4',1]],beats=2,fx=['flash','punch'],words=['NINJA PUNK GIRLS'],size=150,wy=0.1),
 dict(srcs=[[D+'skins_npg_clips_clip-1.mp4',3]],beats=2,fx=['rgb']),
 dict(srcs=[[N+'hero-centre.mp4',1.5]],beats=2,fx=['whip'],seal=1,chip=chip('Ninja Punk Girls')),
 dict(srcs=[[m('akibafury-0'),2.5]],beats=2,fx=['glitch','punch']),
 dict(srcs=[[m('empress-1'),1.0]],beats=2,fx=['punch','rgb'],words=['*LOUD.'],size=230,wy=0.12),
 dict(srcs=[[m('moshpit-0'),1.0]],beats=2,fx=['whip']),
 dict(srcs=[[m('moshpit-1'),2.0]],beats=2,fx=['leak'],seal=1,chip=chip('NPGX')),
 dict(srcs=[[m('lasttrain-1'),2.0]],beats=2,fx=['rgb'],words=['MUSIC.'],size=200,wy=0.12),
 dict(srcs=[[m('gutrqueen-1'),1.5]],beats=2,fx=['punch'],words=['VIDEO.'],size=200,wy=0.12),
 dict(layout='tri',srcs=[[y49,5],[y39,2],[y49,1.5]],beats=2,fx=['flash'],words=['*ART.'],size=200,wy=0.12),
 dict(srcs=[[m('gasoline-1'),2.0]],beats=2,fx=['leak','punch']),
 dict(srcs=[[hf,3.0]],beats=2,fx=['glitch'],words=['*bMOVIES'],size=190,wy=0.12),
 dict(srcs=[[bt+'09a6a075-50be-4368-ab71-afc6af895675.mp4',4]],beats=2,fx=['whip']),
 dict(srcs=[[sf,1.5]],beats=2,fx=['leak'],seal=1,chip=chip('a bMovies creator'),words=['ORIGINALS'],size=150,wy=0.1),
 dict(srcs=[[m('warzone-0'),2.0]],beats=2,fx=['rgb','punch']),
]
for s,ss in [(m('neonriot-0'),2),(m('shinobi-0'),2.5),(m('empress-2'),1),(v15,2),(bt+'31e18325-7365-4512-8871-bdeb64997b54.mp4',4),(m('chainsaw-0'),3),(N+'4.mp4',1.5),(m('gutrqueen-2'),0.5)]:
  S.append(dict(srcs=[[s,ss]],beats=1,fx=['glitch','punch','rgb']))
S.append(dict(kind='black',beats=4,fx=['leak','flash'],seal=1,seal_at=0.0,seal_scale=1.25,seal_pos=(0.5,0.5),words=['ALL OF IT.'],walign='c',size=120,wy=0.1))
S.append(dict(srcs=[[m('moshpit-1'),0.5]],speed=0.5,beats=16,fx=['dim'],words=['YOU MADE IT.','*PROVE IT’S YOURS.'],wstep=2,size=150,wy=0.16,logo=5,fadeout=1))
json.dump(dict(beat=0.39474,logo_png=os.path.join(HERE,'logo.png'),segments=S),open(os.path.join(HERE,'work','edl.json'),'w'),indent=1)
print(sum(s['beats'] for s in S)*0.39474)
