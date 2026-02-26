FROM ollama/ollama:0.16.2

# Pre-pull models at build time so they're baked into the image.
# Start ollama in the background, pull models, then stop it.
RUN ollama serve & \
    SERVER_PID=$! && \
    sleep 5 && \
    ollama pull nomic-embed-text && \
    ollama pull qwen3:8b && \
    kill $SERVER_PID
