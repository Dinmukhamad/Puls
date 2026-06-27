from __future__ import annotations

from datetime import date
from typing import Dict, List, Optional

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.security import get_current_user
from app.database.db import get_db
from app.models.entities import User
from app.services.rating import rating_rows

router = APIRouter(prefix="/rating", tags=["rating"])


@router.get("")
def get_rating(
    week_start: Optional[date] = None,
    week_end: Optional[date] = None,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> List[Dict]:
    return rating_rows(db, week_start, week_end)
