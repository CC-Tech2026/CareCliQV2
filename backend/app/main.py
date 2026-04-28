from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .api import auth, participants, sessions, alerts, plans, reports, ai
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="AI Clinical Companion API",
    description="NDIS Provider Clinical Management System",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix="/api")
app.include_router(participants.router, prefix="/api")
app.include_router(sessions.router, prefix="/api")
app.include_router(alerts.router, prefix="/api")
app.include_router(plans.router, prefix="/api")
app.include_router(reports.router, prefix="/api")
app.include_router(ai.router, prefix="/api")


@app.get("/api/health")
async def health_check():
    return {"status": "healthy", "service": "AI Clinical Companion API"}


@app.get("/")
async def root():
    return {"message": "AI Clinical Companion API", "docs": "/docs"}
