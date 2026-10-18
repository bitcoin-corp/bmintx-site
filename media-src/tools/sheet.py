import sys,glob,os
from PIL import Image,ImageDraw,ImageFont
fs=sorted(glob.glob(sys.argv[1]+'/*.jpg')); cols=10
f=ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial Bold.ttf',30)
for p in range(0,len(fs),60):
  ch=fs[p:p+60]; rows=(len(ch)+cols-1)//cols; S=Image.new('RGB',(cols*320,rows*180))
  for k,x in enumerate(ch):
    im=Image.open(x); d=ImageDraw.Draw(im); d.text((6,4),os.path.basename(x)[:-4].lstrip('0'),font=f,fill='yellow',stroke_width=3,stroke_fill='black'); S.paste(im,((k%cols)*320,(k//cols)*180))
  S.save(f'{sys.argv[2]}{p//60}.jpg',quality=80)
