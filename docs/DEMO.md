# Facet: practical hackathon demo

[Watch/download the video](https://facet-near.vercel.app/media/facet-demo.mp4) · [English captions](../public/media/facet-demo.vtt) · [Subtitle file](../public/media/facet-demo.srt) · [Poster](../public/media/facet-demo-poster.jpg).

This is a narrated, captioned walkthrough assembled from **genuine screenshots of the hosted application**, with small pans and zooms for readability. It is not an uninterrupted screen recording. Waiting time between real operations is omitted. All documents, claims and finance records are fictional demo data.

The capture script used Playwright against the public app. [Capture provenance](../deployments/demo-capture.json) records each screenshot’s source URL, time, measured focus rectangle and SHA-256, plus the real underlying transaction or job evidence. No vault password, holder seed or private delivery recovery file is included. [Render report](../deployments/demo-video.json) gives actual duration, resolution, codecs, timeline and file hash.

## Watch the action and result

| Step | Visible action/result | Real capture |
| --- | --- | --- |
| 1 | Upload → encrypted local file | [02-encrypted-original](demo-captures/02-encrypted-original.jpg) |
| 2 | Create NFT → explicitly unverified | [03-self-recorded-nft](demo-captures/03-self-recorded-nft.jpg) |
| 3 | Issue credential → real BBS signature | [04-issued-credential](demo-captures/04-issued-credential.jpg) |
| 4 | Request → course + completion | [05-request-fields](demo-captures/05-request-fields.jpg) |
| 5 | Preview → approve exact fields | [06-disclosure-preview](demo-captures/06-disclosure-preview.jpg) |
| 6 | Approve → proof ready | [07-owner-approval](demo-captures/07-owner-approval.jpg) |
| 7 | Import proof → no vault required | [08-external-verifier](demo-captures/08-external-verifier.jpg) |
| 8 | Verify → approved claims + NEAR receipt | [09-verified-claims](demo-captures/09-verified-claims.jpg) |
| 9 | Issuer + expiry + revocation + nonce | [10-verification-checks](demo-captures/10-verification-checks.jpg) |
| 10 | Run lab → eight expected outcomes | [12-proof-lab](demo-captures/12-proof-lab.jpg) |
| 11 | Owner confirms → revoked on NEAR | [13-revocation-consent](demo-captures/13-revocation-consent.jpg) |
| 12 | Verify again → revocation fails | [14-revoked-proof](demo-captures/14-revoked-proof.jpg) |

## Narration transcript

A hiring team needs course completion, not your whole certificate. In Facet, I upload training notes into a password-protected local vault.

I create a private document NFT. The original stays on my device. This self-recorded fingerprint is explicitly unverified; uploading does not authenticate it.

Now I issue a fictional training credential from Facet Test Academy. Its claims have a real BBS signature and a holder-bound NEAR record.

The example hiring team requests just the course and completion status. The request binds its purpose, selected fields and a short-lived, single-use nonce.

Before approving, I can see exactly what is shared. Course and completion are revealed. The name, score, date and student reference stay hidden.

I approve and export the proof. The real exported package excludes the hidden name and score, and includes the required public credential bindings.

In a separate browser, the verifier imports my proof without opening a vault or receiving the original document. Then they run the verification checks.

The proof checks out. The verifier sees Data Privacy Foundations and Completed. A genuine NEAR transaction records the single-use verification receipt.

The checks cover signatures, holder approval and live status. NEAR anchors issuer keys, expiry, revocation and nonce use. BBS math runs outside the contract.

The proof lab runs real positive and negative checks, including altered claims and holder substitution. All eight behave as expected. Used requests cannot be replayed.

I generate a fresh unused proof, then revoke the credential. Revocation changes its current NEAR status. It cannot erase information already shared.

That unused proof now fails specifically because of revocation. Facet demonstrates useful credential NFTs with controlled disclosure. Try the live testnet app and inspect the public code.

## Rebuild the video

Use Python 3.11 or newer. Install `scripts/hackathon-demo-requirements.txt` in a virtual environment. Download [Kokoro v1.0](https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx) and [voices-v1.0.bin](https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin) into ignored `reports/demo/tts-model/`.

```bash
python3 -m venv .venv
. .venv/bin/activate
pip install -r scripts/hackathon-demo-requirements.txt
python3 scripts/render-hackathon-demo.py
```

The renderer reads only the public storyboard, screenshots and OFL-licensed Manrope font in `docs/video-tools/`. Kokoro narration runs locally without a paid API. Intermediate audio and model files remain ignored. Final output is 1920×1080 H264/AAC, with faststart, burned-in captions, WebVTT and SRT. Subtitle timing is proportional within each narrated scene. The [Apache-2.0 Kokoro model](https://huggingface.co/hexgrad/Kokoro-82M), [MIT kokoro-onnx library](https://github.com/thewh1teagle/kokoro-onnx) and font retain their own licenses.

To use other model-file locations, pass `--model` and `--voices`. To reuse generated narration, pass `--mode render`. The storyboard contains pronunciation hints and source-shot names. Capture provenance describes the test run; video rendering itself does not sign transactions or access private application data.

BBS verification happens outside the smart contract; the chain anchors keys/status and records designated-relay receipts. Uploads are self-recorded and unverified. The revocation scene uses a **fresh unused proof**, so the rejection demonstrates revocation rather than nonce reuse.

## Capture a new real run

```bash
npx playwright install chromium
node --import tsx scripts/capture-hackathon-demo.ts
```

This deliberately creates real sponsored **testnet** records/jobs and, for Sealwork, uses private inference credits. It writes only screenshots and public evidence. It does not export private vault backups or delivery recovery material. Set `DEMO_BASE_URL` to your own configured deployment if desired. A sandbox that cannot launch Chromium needs a browser-capable host. After a new capture, render again so the video and capture hashes match.
