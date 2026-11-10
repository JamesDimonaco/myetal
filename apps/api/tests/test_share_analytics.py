"""Daily-views zero-fill for the owner analytics chart.

Without it the API returns only days that had views, and the web chart
stretches a single day's bar across the full width.
"""

from datetime import date

from myetal_api.services.share import fill_daily_views


def test_returns_30_days_ending_today_with_gaps_as_zero() -> None:
    days = fill_daily_views({"2026-11-08": 3}, today=date(2026, 11, 10))

    assert len(days) == 30
    assert days[0].date == "2026-10-12"
    assert days[-1].date == "2026-11-10"
    assert [d.count for d in days[-3:]] == [3, 0, 0]
    assert sum(d.count for d in days) == 3


def test_no_views_is_still_30_zero_days() -> None:
    days = fill_daily_views({}, today=date(2026, 11, 10))

    assert len(days) == 30
    assert all(d.count == 0 for d in days)
