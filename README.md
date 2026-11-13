# cam-avoid · 카메라 회피 보조

폰 후면 카메라 영상에서 물체를 인식하고, 카메라 한 대로 거리를 추정한 뒤, 회피 방법 4가지(3구역 최소 위험, 다방향 비용함수, 제동 우선 TTC, 가상 포텐셜필드)의 판단을 화면에 겹쳐 보여주는 웹앱입니다.

**학습·표시용입니다. 실제 운전 판단이나 차량 제어에 쓰지 마세요.**

- 열기: https://jakyumgsa43-web.github.io/cam-avoid/ (안드로이드 크롬, 앱 설치 없음)
- 인식 모델: COCO-SSD (SSDLite MobileNet v2), 가중치를 8비트로 줄여 `index.html` 안에 포함
- 라이브러리: TensorFlow.js 4.22.0, @tensorflow-models/coco-ssd 2.2.3 (둘 다 Apache-2.0, 파일 안에 포함)

## 거리 추정
- 바닥 접점: 박스 아래끝 픽셀 → 카메라 광선 → 평평한 지면(카메라 높이 h, 숙인 각 θ)과 교점
- 물체 크기: 종류별 평균 높이 × 초점거리 ÷ 박스 높이
- 결합: 0.6 × 바닥 접점 + 0.4 × 크기 (박스 아래가 화면 밖이면 크기만)

## 다시 빌드
```
python3 src/quant.py <model.json 폴더> u8 model_u8.js
python3 src/build.py tf.min.js coco-ssd.min.js model_u8.js 출력폴더
```
