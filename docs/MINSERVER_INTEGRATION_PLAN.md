# 민서버 × Bonsai 27B (1-bit Qwen3.6-27B) 연동 플랜

> 기반 자료: 공유해준 인스타 포스트의 모델은 **PrismML Bonsai 27B** — Qwen3.6-27B를
> 1-bit / ternary로 재구축한 모델이다. 사실관계를 웹에서 검증한 뒤 작성한 플랜.

## 0. 검증된 팩트 정리

| 항목 | 1-bit (Bonsai-27B) | Ternary (Ternary-Bonsai-27B) |
|---|---|---|
| 가중치 | binary {−1, +1}, 1.125 bpw | {−1, 0, +1}, 1.71 bpw |
| 파일 크기 | **3.9GB** (Q1_0) | **5.9GB** (Q2_0) |
| FP16 대비 성능 유지율 | ~89.5% | ~94.6% |
| HF 저장소 | `prism-ml/Bonsai-27B-gguf` | `prism-ml/Ternary-Bonsai-27B-gguf` |

- 라이선스: **Apache 2.0** (상업적 사용/게임 연동 자유)
- 런타임: **llama.cpp (CUDA·Metal)**, **MLX** — 단, 커스텀 커널(Q2_0_g128 하이브리드 어텐션)이
  필요해서 **PrismML의 llama.cpp 포크**를 빌드해야 한다 (업스트림 llama.cpp에 아직 없을 수 있음)
- 멀티모달: 비전 타워(0.46B) 유지 — 이미지 입력 가능
- 참고 성능: MacBook에서 ~44 tok/s (포스트 기준), 27B급 최초로 폰에서 구동

## 1. 목표

민서버에서 Bonsai 27B를 **OpenAI 호환 API**(`/v1/chat/completions`)로 상시 서빙하고,
1차 소비자로 **ORBIT HOARDER**(이 저장소)에 LLM 기능을 붙인다.
게임은 LLM 없이도 100% 동작해야 하고, LLM은 순수 부가 기능(코멘터리/코칭)으로만 얹는다.

```
[ORBIT HOARDER (브라우저)] ──HTTPS──▶ [리버스 프록시 (Caddy)] ──▶ [llama-server :8080]
[기타 클라이언트/스크립트] ──────────▶   API key + CORS 처리        Bonsai-27B GGUF
                                        (민서버)
```

## 2. Phase 0 — 민서버 사양 확인 (30분)

플랜 확정 전에 아래만 확인하면 된다:

- [ ] RAM 용량 → **모델 선택 기준**
  - 여유 RAM ≥ 8GB: **Ternary Q2_0 (5.9GB) 권장** — 성능 유지율 95%로 체감 품질이 확실히 낫다
  - 여유 RAM 5~8GB: 1-bit Q1_0 (3.9GB)
  - 그 미만: 이 모델은 무리, 소형 모델로 대체 검토
- [ ] GPU 유무 (NVIDIA → CUDA 빌드 / 없으면 CPU 빌드, Apple Silicon이면 Metal)
- [ ] 디스크 여유 ≥ 15GB (모델 + 빌드 산출물)
- [ ] 외부 접근 방식: LAN 전용인지, 밖에서도 쓸 건지 (→ Phase 2에서 분기)

## 3. Phase 1 — 모델 서빙 (반나절)

```bash
# 1) PrismML llama.cpp 포크 빌드
git clone https://github.com/prism-ml/llama.cpp prism-llama.cpp && cd prism-llama.cpp
cmake -B build -DGGML_CUDA=ON        # GPU 없으면 -DGGML_CUDA=ON 제거
cmake --build build -j

# 2) 모델 다운로드 (Ternary 기준; 1-bit는 prism-ml/Bonsai-27B-gguf의 Bonsai-27B-Q1_0.gguf)
hf download prism-ml/Ternary-Bonsai-27B-gguf Ternary-Bonsai-27B-Q2_0.gguf --local-dir ./models

# 3) 동작 확인
./build/bin/llama-cli -m ./models/Ternary-Bonsai-27B-Q2_0.gguf -p "간단히 자기소개해봐"

# 4) OpenAI 호환 서버로 상시 구동
./build/bin/llama-server -m ./models/Ternary-Bonsai-27B-Q2_0.gguf \
  --host 0.0.0.0 --port 8080 -c 4096 --api-key <임의의-긴-키>
```

- systemd 유닛으로 등록해 부팅 시 자동 시작 + 죽으면 재시작(`Restart=on-failure`)
- 검증: `curl http://민서버:8080/v1/chat/completions -H "Authorization: Bearer <키>" -d '{"messages":[{"role":"user","content":"ping"}]}'`
- 완료 기준: 재부팅 후에도 API가 살아있고, 응답 첫 토큰이 수 초 내에 나온다

## 4. Phase 2 — 네트워크/보안 (반나절)

브라우저 게임에서 직접 호출하려면 두 가지가 필수다:

1. **CORS**: llama-server 앞에 Caddy를 두고 `Access-Control-Allow-Origin`을 게임 도메인으로 제한
2. **Mixed content**: 게임을 HTTPS(GitHub Pages 등)로 서빙하면 브라우저가 `http://민서버`
   호출을 차단한다. 해결책 중 택1:
   - **Tailscale** (권장): 민서버를 tailnet에 넣고 `tailscale cert`로 HTTPS 발급.
     본인 기기에서만 접근 가능 — 개인용으로 가장 안전하고 간단
   - Cloudflare Tunnel: 공개 서비스로 열고 싶을 때. 단, API key 필수 + 요청량 제한 넣을 것
   - 로컬 플레이 전용: 민서버가 게임 파일도 같이 서빙 (Caddy 정적 서빙) — mixed content 문제 자체가 사라짐

- API key는 클라이언트에 노출된다는 점을 감안 — 공개 배포 시엔 키를 게임에 심지 말고
  Caddy에서 rate limit + origin 제한으로 방어하는 쪽이 현실적
- 완료 기준: 게임이 뜬 브라우저 콘솔에서 fetch로 API 호출이 성공한다

## 5. Phase 3 — ORBIT HOARDER 연동 (1일)

### 5-1. 게임오버 코멘터리 (첫 기능, 최소 침습)

현재 게임오버 시 `index.html`의 `gameOver()`가 `FINAL {score} — TAP TO RESTART`를 띄운다
(`index.html:200` 부근). 여기에 LLM 한 줄 코멘트를 비동기로 덧붙인다:

```js
var MINSERVER = 'https://민서버주소';           // Tailscale MagicDNS 등
function fetchComment(score, cb) {
  var ctl = new AbortController();
  setTimeout(function () { ctl.abort(); }, 2500);   // 2.5초 안에 안 오면 포기
  fetch(MINSERVER + '/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: ctl.signal,
    body: JSON.stringify({
      messages: [
        { role: 'system', content: '너는 아케이드 게임의 짓궂지만 유쾌한 아나운서다. 한국어 한 문장, 30자 이내.' },
        { role: 'user', content: '점수 ' + score + '점으로 게임오버. 한마디.' }
      ],
      max_tokens: 48, temperature: 0.9
    })
  })
    .then(function (r) { return r.json(); })
    .then(function (d) { cb(d.choices[0].message.content); })
    .catch(function () { cb(null); });               // 실패 시 조용히 기본 문구 유지
}
```

원칙: **타임아웃 + 실패 시 무반응**. 민서버가 꺼져 있어도 게임은 지금과 완전히 동일하게 동작.

### 5-2. 플레이 코칭 (2차)

게임오버 시 요약 스탯(생존 시간, 위성 수, 놓친 파편 수 — `window.__GAME`에 이미 노출 중)을
프롬프트에 넣어 "다음 판 팁" 한 줄 생성. 5-1과 같은 엔드포인트, 프롬프트만 다름.

### 5-3. 비전 활용 (실험, 선택)

Bonsai는 비전 타워가 살아 있으므로 `canvas.toDataURL()`로 게임오버 순간 스크린샷을 보내
"배치가 왜 뚫렸는지" 코멘트를 받는 것도 가능. 단 이미지 인코딩 비용 + 응답 지연이 커서
기술 데모 성격 — 5-1/5-2가 안정된 뒤에만.

## 6. 리스크와 대응

| 리스크 | 대응 |
|---|---|
| 포크 llama.cpp 빌드 실패 / 커널 미지원 하드웨어 | Phase 0에서 사양 먼저 확인. 안 되면 업스트림 llama.cpp + 일반 Qwen 소형 모델(Q4)로 대체해도 게임 연동부(Phase 2~3)는 그대로 재사용 가능 |
| CPU-only 서버라 토큰 속도 느림 | 코멘터리는 max_tokens ≤ 48로 짧게. 스트리밍 불필요. 2.5초 타임아웃이 UX 방어선 |
| 1-bit 품질(90%)로 한국어 코멘트가 어색 | Ternary(95%) 우선 시도. 시스템 프롬프트에 예시 문장 2~3개 few-shot |
| API 공개 노출 | 기본은 Tailscale(비공개). 공개 시 rate limit + origin 제한 |

## 7. 순서 요약

1. **Phase 0**: 민서버 RAM/GPU 확인 → 모델(1-bit vs Ternary) 확정 — *30분*
2. **Phase 1**: 포크 빌드 + GGUF 다운로드 + llama-server systemd 상시 서빙 — *반나절*
3. **Phase 2**: Caddy(CORS) + Tailscale HTTPS — *반나절*
4. **Phase 3**: 게임오버 코멘터리(5-1) → 코칭(5-2) → 비전 데모(5-3) — *1일*

각 Phase가 독립적으로 가치가 있음: Phase 1만 끝나도 민서버가 범용 로컬 LLM API가 되고,
Phase 3은 그 첫 번째 소비자일 뿐이다.

## 참고 링크

- 1-bit 모델: https://huggingface.co/prism-ml/Bonsai-27B-gguf
- Ternary 모델: https://huggingface.co/prism-ml/Ternary-Bonsai-27B-gguf
- 릴리스 기사: https://www.marktechpost.com/2026/07/14/prismml-releases-bonsai-27b-1-bit-and-ternary-builds-of-qwen3-6-27b-that-run-on-laptops-and-phones/
