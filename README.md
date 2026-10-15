# stock8-7

4개 종목 캔들차트를 한 화면에 보여주는 KIS 우선 실시간 주식 대시보드입니다.

## 실행

GitHub Codespaces 또는 로컬 환경변수에 아래 값을 설정한 뒤 실행합니다. 실제 키 값은 저장소에 커밋하지 않습니다.

```bash
export KIS_APP_KEY="..."
export KIS_APP_SECRET="..."
export KIS_BASE_URL="https://openapi.koreainvestment.com:9443"
export KIS_WS_URL="ws://ops.koreainvestment.com:21000"
export PORT=8002
npm start
```

KIS 환경변수가 없거나 KIS 응답이 실패하면 기존 공개 시세 데이터로 fallback합니다.

## GitHub Codespaces Secret 설정

KIS 키는 GitHub 저장소 파일에 넣지 말고 Codespaces Secret으로 설정합니다.

1. GitHub에서 `ddubii00/ddubii00-stock8-7` 저장소로 이동합니다.
2. `Settings` → `Secrets and variables` → `Codespaces`로 이동합니다.
3. `New repository secret` 또는 `New secret`을 눌러 아래 이름으로 추가합니다.
   - `KIS_APP_KEY`
   - `KIS_APP_SECRET`
   - `KIS_BASE_URL`
   - `KIS_WS_URL`
4. 값은 각각 KIS에서 발급받은 값을 넣습니다.
5. Codespace를 이미 켜둔 상태라면 재시작하거나 새 Codespace를 만듭니다.
6. Codespace 터미널에서 실행합니다.

```bash
npm start
```

Codespaces Secret은 터미널 환경변수로 자동 주입됩니다. GitHub Actions용 Secret만 만들면 Codespace 터미널에서 보이지 않을 수 있으니, 반드시 Codespaces Secret으로 설정합니다. `KIS_APP_KEY`, `KIS_APP_SECRET`은 Variables가 아니라 Secrets에 넣는 것을 권장합니다.

## 로컬 테스트

로컬에서는 `.env.example`을 참고해서 직접 환경변수를 export한 뒤 실행합니다. `.env` 파일을 만들 경우 `.gitignore`에 의해 커밋되지 않습니다.

## Oracle 서버 실행

Oracle Cloud VM에서는 Node.js 20 이상을 설치한 뒤 저장소를 받아 실행합니다. KIS 키는 저장소에 커밋하지 말고 서버의 `.env` 파일 또는 systemd 환경변수로만 설정합니다.

```bash
git clone https://github.com/ddubii00/ddubii00-stock8-7.git
cd ddubii00-stock8-7
npm install
cp .env.example .env
# .env에 KIS_APP_KEY, KIS_APP_SECRET, PORT를 설정
npm start
```

외부 접속이 필요하면 Oracle 보안 목록/NSG와 서버 방화벽에서 `PORT` 값을 허용합니다. 기본 예시는 `PORT=8002`입니다.

## 차트 조작

- 이평선은 5·10·20·60·120·200기간이며, 색상은 stock5-8과 같습니다.
- 상단 **BB**: 네 차트의 볼린저밴드(20기간 평균 ± 2 표준편차)를 함께 표시/숨김합니다. 각 차트의 BB 범례로 개별 조절도 가능합니다.
- 상단 **주**: 네 차트를 주봉으로 바꾸고, 해제하면 각 차트의 이전 주기와 조회기간으로 돌아갑니다. 활성화 중에도 개별 봉 선택이 가능합니다.
- 상단 **삼선**: stock5-8과 같은 종가 기준 삼선전환도로 전환합니다. 이평선과 BB는 전환선 기준으로 계산하며, MACD 배경은 숨깁니다. 해제하면 원본 캔들과 배경을 복원합니다.
- **Y축 범위**: 오른쪽 가격 눈금을 위아래로 드래그합니다. 더블클릭하면 자동 범위로 돌아갑니다. 실시간 갱신 중에는 수동 범위를 유지하고, 종목·주기 변경 시 자동 범위로 시작합니다.
- **ETF 검색**: 국내 ETF를 이름·브랜드명(KODEX, TIGER 등)·종목코드로 검색할 수 있습니다. ETF 목록은 12시간 캐시하고 갱신 실패 시 마지막 정상 목록을 사용합니다. 미국 ETF는 기존 미국 종목 검색 및 티커 직접 입력을 지원합니다.

## 검증

```bash
npm test
```

200기간 이평선, 볼린저밴드, 삼선전환, 주봉 복원, ETF 검색 및 캐시 장애 복구를 검증합니다.
