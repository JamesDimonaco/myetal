from myetal_api.models.auth_identity import AuthIdentity, AuthProvider
from myetal_api.models.base import Base
from myetal_api.models.feedback import Feedback, FeedbackType
from myetal_api.models.orcid_sync_run import OrcidSyncRun, OrcidSyncStatus
from myetal_api.models.paper import Paper, PaperSource
from myetal_api.models.refresh_token import RefreshToken
from myetal_api.models.share import ItemKind, Share, ShareItem, ShareType
from myetal_api.models.share_paper import SharePaper
from myetal_api.models.share_report import ShareReport, ShareReportReason, ShareReportStatus
from myetal_api.models.share_similar import ShareSimilar
from myetal_api.models.share_view import ShareView
from myetal_api.models.tag import ShareTag, Tag
from myetal_api.models.trending_share import TrendingShare
from myetal_api.models.user import User
from myetal_api.models.user_paper import UserPaper, UserPaperAddedVia

__all__ = [
    "AuthIdentity",
    "AuthProvider",
    "Base",
    "Feedback",
    "FeedbackType",
    "ItemKind",
    "OrcidSyncRun",
    "OrcidSyncStatus",
    "Paper",
    "PaperSource",
    "RefreshToken",
    "Share",
    "ShareItem",
    "SharePaper",
    "ShareReport",
    "ShareReportReason",
    "ShareReportStatus",
    "ShareSimilar",
    "ShareTag",
    "ShareType",
    "ShareView",
    "Tag",
    "TrendingShare",
    "User",
    "UserPaper",
    "UserPaperAddedVia",
]
