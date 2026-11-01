# Specs

* [A local transcription engine for Stenographer](Local-Transcription-Engine.md) - Stenographer routes every job to a paid API, which is correct for public YouTube and wrong for a founder call. A third engine speaking the OpenAI transcription API against a user-supplied base URL covers whisper.cpp, Speaches and MLX in one integration — but it forces the pipeline's first real change: from URL-in to source-in.
