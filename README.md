# stock8-7

4개 종목 캔들차트를 한 화면에 보여주는 KIS 우선 실시간 주식 대시보드입니다.

## 실행

GitHub Codespaces 또는 로컬 환경변수에 아래 값을 설정한 뒤 실행합니다.

```bash
export KIS_APP_KEY="..."
export KIS_APP_SECRET="..."
export KIS_BASE_URL="https://openapi.koreainvestment.com:9443"
export KIS_WS_URL="ws://ops.koreainvestment.com:21000"
export PORT=8002
npm start
```

KIS 환경변수가 없거나 KIS 응답이 실패하면 기존 공개 시세 데이터로 fallback합니다.
