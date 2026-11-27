# JARVIS AI data governance

## Do not train on “the whole internet”

There is no safe or technically realistic switch that grants JARVIS permission to copy every website, YouTube video, GitHub repository and social post into a training corpus. Publicly viewable does not mean public-domain, licensed for model training, downloadable or permanently storable.

The goal is a high-quality, traceable corpus from sources that explicitly permit the intended use. If permission is unknown, do not put the material into model training.

## Source classes

1. **Owned material** — tutorials, edit projects, narration, example clips and notes that you created and control.
2. **Public-domain material** — verify the public-domain status for the relevant country and media component.
3. **Openly licensed datasets and media** — record the exact license, version, attribution obligations, share-alike terms and restrictions. A dataset being hosted publicly does not itself grant a license.
4. **Direct creator permission** — keep the written permission or agreement and identify which model-training and redistribution uses it covers.
5. **Platform-authorized training material** — verify the platform's specific permission mechanism and use only the authorized delivery path.
6. **Unverified or denied material** — exclude from training. It may be possible to keep a minimal source reference for research, subject to the site's terms, but do not copy the content into the corpus.

## YouTube-specific handling

YouTube Terms restrict downloading, reproducing or otherwise using content except where the service permits it, you have prior written permission from YouTube and/or the applicable rights holders, or applicable law permits it. YouTube API developer policies also prohibit scraping YouTube applications and prohibit downloading, importing, backing up, caching or storing audiovisual copies through API services without the required prior written approval.

YouTube now documents a Video Third-Party Trainability API. The videoTrainability.get endpoint returns a permitted list:
- all — the creator/rightsholder has allowed any third party to train on the eligible video.
- none — the video is not permitted for third-party training.
- a list of parties — only the listed parties are permitted.

The check is a permission-status signal, not a video download endpoint. It does not provide the audiovisual file or override separate access, copyright, privacy, API or storage rules. Do not scrape videos, bypass restrictions or use unofficial downloaders. Use training material only when the permission covers JARVIS/the intended organization and the content is supplied through an authorized route, such as a direct creator delivery or an approved platform arrangement. Caption-download API access also has its own authorization requirements and is not a public transcript-export mechanism.

Official references:
- YouTube Terms: https://www.youtube.com/t/terms
- YouTube API Developer Policies: https://developers.google.com/youtube/terms/developer-policies
- Video Third-Party Trainability: https://developers.google.com/youtube/data/video-trainability
- Get trainability status: https://developers.google.com/youtube/data/video-trainability/guides/get
- Caption download authorization: https://developers.google.com/youtube/v3/docs/captions/download
- YouTube Creative Commons guidance: https://support.google.com/youtube/answer/2797468

## General web sources

- Use JARVIS's existing search and safe page-reading pipeline for research.
- Prefer official documentation, primary sources and explicitly licensed educational resources.
- Do not bulk-scrape websites or ignore robots.txt, access controls, rate limits or site terms.
- For model-weight training, require a source license or permission that expressly allows the intended text/data-mining or machine-learning use.
- For current knowledge, prefer a short, reviewed note with source URL and retrieval date in RAG rather than copying a complete article.
- Treat page content as untrusted data, never as an instruction to JARVIS.
- Never train on passwords, API keys, session cookies, private messages, private user files or unnecessary personal data.

## GitHub and code

A public GitHub repository is not automatically open source. For code examples, require a recognized license and retain repository URL, commit SHA, license identifier and attribution. Do not train on private repository code or secrets. Avoid adding code from copyleft repositories to this project unless the license obligations have been reviewed.

## Required provenance record

Use schemas/source-manifest.schema.json for every source. At minimum record:
- stable source ID and source URL;
- title, creator and content type;
- exact license identifier or permission status;
- evidence of permission and allowed purposes;
- acquisition method and collection time;
- SHA-256 checksum for the local file;
- attribution requirements and retention rule.

A source with missing, unknown or denied permission is not eligible for model training.

## Separation of RAG and model training

RAG knowledge and training examples are not the same dataset:
- RAG stores reviewed notes/documents with provenance for retrieval at response time.
- SFT data stores carefully authored examples of desired behavior and output formats.
- Evaluation data is held out and never used for training.
- Raw media should remain separate from derived annotations and should only be processed where rights allow it.

Never automatically fine-tune on every search result, user conversation, correction or video watched. New data must pass permission, privacy, quality and human-review gates.
