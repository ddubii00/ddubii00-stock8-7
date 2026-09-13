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
