from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routers import resumes, jd, ai

app = FastAPI(title="Career Copilot API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:3001", "https://*.vercel.app"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(resumes.router)
app.include_router(jd.router)
app.include_router(ai.router)


@app.get("/health")
async def health():
    return {"status": "ok"}
