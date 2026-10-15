# stock8-7

4개 차트씩 총 5페이지(20칸)를 제공하는 KIS 우선 실시간 주식 대시보드입니다. 종목 설정과 추세선을 서버에 저장합니다.

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

## 비밀번호 접속과 서버 저장

접속 비밀번호 기본값은 `1222`입니다. 서버 환경변수 `STOCK8_PASSWORD`로 변경할 수 있습니다. 비밀번호 검증과 API 접근 제어는 서버에서 수행하며, 로그인은 HttpOnly 쿠키로 30일 유지됩니다.

종목·봉 주기·조회기간·선 정보는 `STOCK8_DATA_DIR` 아래 `dashboard.json`에 저장합니다. 기본 경로는 실행 폴더의 `data/`입니다. 로그인 서명 키도 같은 폴더의 `session-key`에 보관하므로 서버를 재시작해도 로그인과 저장 정보가 유지됩니다. 이 폴더는 Git에서 제외됩니다.

- 여러 컴퓨터에서 **같은 서버 주소**에 접속하면 같은 20칸과 선 정보를 불러옵니다. 다른 창의 변경은 약 5초마다 반영됩니다.
- 각 변경은 차트 칸·선 ID 단위로 병합하고, 파일은 임시 파일에서 원자적으로 교체합니다. 재전송한 변경은 중복 적용하지 않습니다.
- 기존 브라우저에 저장된 4개 종목은 서버가 아직 수정되지 않았을 때만 첫 페이지로 가져옵니다.
- 네트워크 오류 시 임시 변경을 브라우저에 유지하고 재시도합니다. 저장 연결 오류가 발생할 때만 헤더에 표시합니다.
- 배포·백업 시 **데이터 폴더를 보존**하세요. Docker를 사용할 경우 이 경로를 호스트 볼륨에 연결해야 합니다. 이 파일 저장 방식은 하나의 Node 서버 프로세스를 기준으로 합니다.

```bash
# 예: 코드 폴더 밖에 데이터를 보존하려는 경우
export STOCK8_DATA_DIR=/var/lib/stock8-7
export STOCK8_PASSWORD=1222
npm start
```

## 차트 조작

- 상단 **배치**: `2×2 → 4×1 → 1×4 → 2×2` 순환입니다. 가로 칸 수 × 세로 칸 수이며, 접속 기본값은 2×2입니다. 모든 배치에서 네 차트가 스크롤 없이 한 화면 안에 맞춰집니다.
- 상단 **다음**: `1/5 → 2/5 → … → 5/5 → 1/5` 순환입니다. 페이지마다 독립된 4개 종목을 지정할 수 있습니다.
- 차트의 **선**: 버튼을 누르고 시작점부터 끝점까지 드래그합니다. 선을 클릭해 선택한 후 끝점을 드래그하면 위치를 수정할 수 있습니다. **굵기**는 1→2→3 순환, **선 삭제**와 Delete/Backspace는 선택한 선을 삭제합니다. 선택이 없을 때 선 삭제 버튼은 해당 종목의 모든 선을 삭제합니다. Esc는 그리기를 취소합니다.
- 선은 날짜·가격으로 저장되며 **종목별로 공유**됩니다. 같은 종목을 다른 페이지나 봉 주기에서 보더라도 같은 선 정보를 사용합니다. 로드한 기간 밖의 끝점은 숨기고 원래 날짜를 보존합니다.

- 이평선은 5·10·20·60·120·200기간이며, 색상은 stock5-8과 같습니다.
- 상단 **BB**: 네 차트의 볼린저밴드(20기간 평균 ± 2 표준편차)를 함께 표시/숨김합니다. 각 차트의 BB 범례로 개별 조절도 가능합니다.
- 상단 **주**: 네 차트를 주봉으로 바꾸고, 해제하면 각 차트의 이전 주기와 조회기간으로 돌아갑니다. 활성화 중에도 개별 봉 선택이 가능합니다.
- 상단 **삼선**: stock5-8과 같은 종가 기준 삼선전환도로 전환합니다. 이평선과 BB는 전환선 기준으로 계산하며, MACD 배경은 숨깁니다. 해제하면 원본 캔들과 배경을 복원합니다.
- **Y축 범위**: 오른쪽 가격 눈금을 위아래로 드래그합니다. 더블클릭하면 자동 범위로 돌아갑니다. 실시간 갱신 중에는 수동 범위를 유지하고, 종목·주기 변경 시 자동 범위로 시작합니다.
- **종목코드·티커 검색**: `005930` 또는 `5930`은 삼성전자, `196170`은 알테오젠처럼 국내 코드를 실제 종목명·시장으로 인식합니다. 미국 주식은 `AAPL`, `aapl`, `AAPL.US`처럼 티커로 입력할 수 있고, 정확히 일치하는 티커를 우선 표시합니다.
- **ETF 검색**: 국내 ETF를 이름·브랜드명(KODEX, TIGER 등)·종목코드로 검색할 수 있습니다. ETF 목록은 12시간 캐시하고 갱신 실패 시 마지막 정상 목록을 사용합니다. 미국 ETF는 기존 미국 종목 검색 및 티커 직접 입력을 지원합니다.

## 검증

```bash
npm test
```

200기간 이평선, 볼린저밴드, 삼선전환, 주봉 복원, ETF 검색, 비밀번호 세션, 서버 저장·복원, 동시 변경 병합 및 추세선 좌표를 검증합니다.
