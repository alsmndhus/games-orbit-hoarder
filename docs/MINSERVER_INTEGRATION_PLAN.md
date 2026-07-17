# 민서버 → 개인 오프라인 AI 서버 전환 플랜 (Bonsai 27B)

> 기반 자료: 공유해준 포스트의 모델은 **PrismML Bonsai 27B** — Qwen3.6-27B를 1-bit로
> 재구축한 모델. 포스트의 5가지 팩트가 이 플랜의 근거다.

## 0. 포스트의 핵심 — 왜 이게 민서버에 중요한가

포스트 텍스트 그대로:

1. **Qwen3.6-27B의 1-bit 재구축, 단 3.9GB**
2. **1-bit인데 원본 성능의 90% 유지**
3. **폰에서 도는 최초의 27B급 모델**
4. **MacBook에서 44 tok/s, 완전 오프라인**
5. **Apache 2.0, llama.cpp와 MLX에서 구동**

이걸 민서버 관점으로 번역하면:

| 포스트 팩트 | 민서버에게 의미하는 것 |
|---|---|
| 3.9GB (원래 27B FP16은 ~54GB) | **고사양 GPU가 없어도 된다.** 폰에서 돌 정도면 평범한 미니서버 RAM으로 충분 |
| 90% 성능 유지 | 장난감이 아니라 실사용 품질. 지금까지 저사양 서버는 3~8B급이 한계였는데 **27B급으로 체급이 3배 이상 점프** |
| 폰에서 구동 | 민서버가 최저 사양이어도 구동 자체는 보장 수준 |
| 완전 오프라인, 44 tok/s | 클라우드 API 없이 내 하드웨어에서 실시간 대화 속도. **구독료 0원, 데이터가 집 밖으로 안 나감** |
| Apache 2.0 + llama.cpp/MLX | 상업적 이용 포함 자유. 민서버 OS/하드웨어(리눅스/맥/CPU/GPU) 거의 안 가림 |

**한 줄 요약: 지금까지 클라우드에 내던 돈과 데이터를, 민서버 한 대로 대체할 수 있게 됐다.**
이 플랜의 목표는 민서버를 "내 모든 기기(폰·노트북)가 접속하는 개인 AI 서버"로 만드는 것.

## 1. 목표 아키텍처

```
[폰]      ──┐
[노트북]  ──┤── Tailscale (사설망, HTTPS) ──▶ [민서버]
[다른 앱] ──┘                                  ├─ llama-server :8080  ← Bonsai-27B GGUF
                                               │   (OpenAI 호환 API /v1/chat/completions)
                                               └─ Open WebUI :3000   ← 챗 UI (선택)
```

- 완전 오프라인: 외부 API 호출 없음. 인터넷이 끊겨도 AI는 동작
- OpenAI 호환 API라서 기존 OpenAI SDK 쓰는 모든 도구·앱에 주소만 바꿔 꽂을 수 있음

## 2. 모델 선택 (두 가지 빌드)

| | 1-bit `Bonsai-27B` | Ternary `Ternary-Bonsai-27B` |
|---|---|---|
| 크기 | 3.9GB | 5.9GB |
| 성능 유지율 | ~89.5% | ~94.6% |
| 필요 여유 RAM (대략) | ~5–6GB | ~7–8GB |
| HF 저장소 | `prism-ml/Bonsai-27B-gguf` | `prism-ml/Ternary-Bonsai-27B-gguf` |

- **여유 RAM이 8GB 이상이면 Ternary 권장** — 2GB 더 쓰고 성능 5%p를 사는 게 남는 장사
- RAM이 빠듯하면 1-bit — 포스트의 주인공이자 "폰에서도 도는" 그 빌드
- 둘 다 비전 타워(0.46B)가 살아 있어 **이미지 입력 가능** (문서 사진 요약 등)

## 3. Phase 0 — 민서버 사양 확인 (30분)

- [ ] `free -h` → 여유 RAM 확인 → 위 표로 모델 확정
- [ ] GPU 유무 (`nvidia-smi`) → 있으면 CUDA 빌드, 없어도 CPU로 충분히 구동 가능
- [ ] 디스크 여유 ≥ 15GB
- [ ] OS/아키텍처 확인 (x86_64 리눅스 / ARM / 맥 — llama.cpp는 전부 지원)

## 4. Phase 1 — 모델 서빙 (반나절)

주의: 이 모델의 1-bit/ternary 커널(Q1_0, Q2_0_g128)은 **PrismML의 llama.cpp 포크**에만
있다. 업스트림 llama.cpp로는 아직 안 돌 수 있음.

```bash
# 1) PrismML llama.cpp 포크 빌드
git clone https://github.com/prism-ml/llama.cpp prism-llama.cpp && cd prism-llama.cpp
cmake -B build -DGGML_CUDA=ON        # GPU 없으면 -DGGML_CUDA=ON 제거
cmake --build build -j

# 2) 모델 다운로드 (Ternary 기준; 1-bit는 prism-ml/Bonsai-27B-gguf의 Bonsai-27B-Q1_0.gguf)
hf download prism-ml/Ternary-Bonsai-27B-gguf Ternary-Bonsai-27B-Q2_0.gguf --local-dir ./models

# 3) 단발 테스트
./build/bin/llama-cli -m ./models/Ternary-Bonsai-27B-Q2_0.gguf -p "간단히 자기소개해봐"

# 4) OpenAI 호환 API 상시 서빙
./build/bin/llama-server -m ./models/Ternary-Bonsai-27B-Q2_0.gguf \
  --host 0.0.0.0 --port 8080 -c 8192 --api-key <임의의-긴-키>
```

- systemd 유닛 등록: 부팅 시 자동 시작, `Restart=on-failure`
- **벤치마크 기록**: 포스트 기준 MacBook 44 tok/s. 민서버가 CPU-only면 더 낮을 수 있으니
  `llama-bench`로 실측해서 기대치를 잡는다 (대화용은 10 tok/s 이상이면 실사용 가능)
- 완료 기준: 재부팅 후에도 `curl http://localhost:8080/v1/chat/completions ...`가 응답

## 5. Phase 2 — 내 기기들과 연동 (반나절)

핵심 팩트 4번("완전 오프라인")을 지키면서 폰·노트북에서 쓰는 구성:

1. **Tailscale** 설치 (민서버 + 폰 + 노트북)
   - 공유기 포트포워딩 없이 어디서든 사설망 접속, `tailscale cert`로 HTTPS까지 해결
   - 외부 인터넷에 API가 노출되지 않음 — 개인 서버에 가장 안전한 기본값
2. **Open WebUI** (선택, 도커 한 줄) — ChatGPT 같은 챗 화면. 폰 브라우저에서
   `https://민서버.tailnet주소:3000` 접속하면 끝. 대화 기록도 민서버에만 저장
3. **기존 도구 연결** — OpenAI 호환이므로:
   - 코딩 도구/에이전트: base URL만 `http://민서버:8080/v1`로 변경
   - 스크립트·자동화: OpenAI SDK 그대로 사용
   - 비전: 이미지 첨부해 문서 사진 요약, 스크린샷 질문 등

- 완료 기준: **폰에서** 챗 UI로 대화가 되고, 노트북에서 SDK 호출이 성공한다

## 6. Phase 3 — 활용 확장 (이후 천천히)

- 개인 자동화: 메모/문서 요약, RSS 요약 브리핑 등 cron 작업을 전부 로컬 모델로
- 프로젝트 연동: 이 저장소의 게임(ORBIT HOARDER)에 코멘터리 붙이기 같은 것도
  API 소비자 하나를 추가하는 일일 뿐 — 서버 쪽 작업은 Phase 1~2에서 이미 끝나 있다
- 모델 교체 실험: 같은 llama-server 자리에 GGUF만 갈아끼우면 되므로
  이후 더 좋은 저비트 모델이 나오면 무중단급으로 업그레이드 가능

## 7. 리스크와 대응

| 리스크 | 대응 |
|---|---|
| 포크 llama.cpp가 민서버 아키텍처에서 빌드 실패 | Phase 0에서 사양 먼저 확인. 실패 시 업스트림 llama.cpp + Qwen 소형 모델(Q4)로 우선 개통하고, 커널이 업스트림에 머지되면 Bonsai로 교체 |
| CPU-only라 44 tok/s에 못 미침 | `llama-bench` 실측 후 기대치 조정. 10 tok/s 이상이면 대화용 충분. 컨텍스트(-c)를 4096으로 줄이면 메모리·속도 여유 확보 |
| 1-bit 품질(90%)이 용도에 부족 | Ternary(95%)로 상향, 그래도 부족한 작업만 선별적으로 클라우드 병행 |
| RAM 부족으로 스왑 발생 | 1-bit(3.9GB) 선택 + `-c 4096` + 다른 서비스 메모리 정리 |

## 8. 순서 요약

1. **Phase 0** — 사양 확인, 모델 확정 (*30분*)
2. **Phase 1** — 포크 빌드 → GGUF → llama-server 상시 서빙 + 속도 실측 (*반나절*)
3. **Phase 2** — Tailscale + Open WebUI → 폰/노트북에서 사용 개시 (*반나절*)
4. **Phase 3** — 자동화·프로젝트 연동은 필요할 때마다 하나씩

Phase 2가 끝나는 순간이 이 플랜의 본전 회수 시점: **폰에서 내 서버의 27B 모델과
완전 오프라인으로 대화하는 상태.** 포스트가 말한 다섯 가지 팩트가 전부 그 한 장면에 들어있다.

## 참고 링크

- 1-bit 모델: https://huggingface.co/prism-ml/Bonsai-27B-gguf
- Ternary 모델: https://huggingface.co/prism-ml/Ternary-Bonsai-27B-gguf
- 릴리스 기사: https://www.marktechpost.com/2026/07/14/prismml-releases-bonsai-27b-1-bit-and-ternary-builds-of-qwen3-6-27b-that-run-on-laptops-and-phones/
