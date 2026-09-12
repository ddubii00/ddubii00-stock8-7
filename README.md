# stock12 삼선전환도

종가만으로 계산하는 삼선전환도 대시보드입니다. 캔들·이동평균선은 표시하지 않으며, 차트 배경은 MACD(12, 26) 양수는 빨강, 음수는 파랑으로 표시합니다. 조회기간과 분/일/주/월 단위는 각 차트에서 바꿀 수 있습니다.

- 분봉에서 MACD 배경색이 전환되면 작은 알림이 나타납니다.
- 전환 이후 삼선전환도 봉이 두 개 생성되면 두 번째 위치의 알림으로 교체됩니다.
- 알림은 `확인`으로 닫을 수 있으며, 닫기 전에 새 알림이 발생하면 새 내용으로 대체됩니다.
- 모든 시세는 30초마다 갱신됩니다. Oracle에서는 KIS를 우선 사용하고, 키가 없거나 실패한 경우 네이버/Yahoo 공개 시세로 폴백합니다. Vercel은 KIS 비밀키 없이 네이버/Yahoo 공개 시세 경로를 사용합니다.

## Oracle Cloud VM 실행 (KIS 실시간)

Node.js 20 이상에서 실행합니다. KIS 키는 절대로 저장소에 커밋하지 말고 Oracle의 `.env` 또는 systemd 환경변수로만 넣습니다.

```bash
git clone https://github.com/ddubii00/ddubii00-stock8-7.git
cd ddubii00-stock8-7
npm install
cp .env.example .env
# .env에 KIS_APP_KEY, KIS_APP_SECRET, KIS_BASE_URL, BASE_PATH, PORT를 설정
npm start
```

기본 `BASE_PATH=/stock12`이므로 리버스 프록시 하위 경로에서도 `https://서버주소/stock12`로 접근할 수 있습니다. 루트로 서비스하려면 `BASE_PATH=/`로 설정합니다. 방화벽/NSG에는 선택한 `PORT` 또는 프록시 포트를 허용합니다.

## Vercel 배포

저장소를 Vercel에 Import하면 `api/[...path].js`가 서버리스 API로 배포되고, 정적 화면은 자동 제공됩니다. `/` 및 `/stock12` 경로를 지원합니다. Vercel 환경변수에는 KIS 키를 넣지 않아도 되며, 공개 시세가 약 30초 단위로 갱신됩니다.

## 로컬 확인

```bash
npm install
npm start
```

`http://127.0.0.1:8000` 또는 `http://127.0.0.1:8000/stock12`에서 확인합니다.
