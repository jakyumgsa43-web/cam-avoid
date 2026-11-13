"""cam_avoid 빌드: shell.html + tf.min.js + coco-ssd.min.js + 모델(8비트) + app.js → 단일 HTML
사용: python3 build.py <tf.min.js> <coco-ssd.min.js> <model_u8.js> <출력폴더>
출력: index.html (GitHub Pages용 완전한 문서), cam_avoid_artifact.html (Claude 링크용 본문)"""
import sys, os, re
here = os.path.dirname(os.path.abspath(__file__))
tf, coco, model, out = sys.argv[1:5]

def js(path):
    s = open(path, encoding='utf-8').read()
    return re.sub(r'</(script)', r'<\\/\1', s, flags=re.I).replace('<!--', '<\\!--')

shell = open(os.path.join(here, 'shell.html'), encoding='utf-8').read()
scripts = ''.join('<script>%s</script>\n' % js(p) for p in (tf, coco, model, os.path.join(here, 'app.js')))
body = shell + '\n' + scripts
os.makedirs(out, exist_ok=True)
open(os.path.join(out, 'cam_avoid_artifact.html'), 'w', encoding='utf-8').write(body)
full = ('<!doctype html><html lang="ko"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">'
        '<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px);box-sizing:border-box}'
        '[hidden]{display:none!important}img{max-width:100%}body{margin:0;font-size:14px}</style>'
        '</head><body>\n' + body + '</body></html>\n')
open(os.path.join(out, 'index.html'), 'w', encoding='utf-8').write(full)
print('index.html', len(full.encode()), 'bytes')
