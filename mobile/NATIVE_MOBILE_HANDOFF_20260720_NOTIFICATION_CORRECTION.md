# Native Mobile Enhancement Handoff — 2026-07-20 (Notification Subscriptions, Preferences, and Gestures)

## Summary

This correction tranche completes the native mobile notification features that were previously requested but not fully delivered. The mobile application now includes **parcel-level notification subscriptions**, a **dedicated notification preferences screen**, and **swipe gestures** in the inbox for dismiss and mark-as-read actions. The unread badge is also now reactive, so badge counts update immediately as inbox state changes.

## What Was Added

| Area | Status | Notes |
|---|---:|---|
| Parcel-level subscriptions | Complete | Operators can follow or unfollow parcel-tagged alerts directly from the parcel detail screen. |
| Notification preferences screen | Complete | Users can control master push delivery, category-level alerts, and assigned-parcel-only behavior. |
| Parcel-aware delivery rules | Complete | Local alert delivery now respects category toggles and followed-parcel constraints. |
| Reactive unread badge | Complete | The tab-shell badge updates when items are read, dismissed, or newly logged. |
| Swipe-to-dismiss gesture | Complete | Left-swipe behavior dismisses inbox cards. |
| Swipe-to-mark-read gesture | Complete | Right-swipe behavior marks unread inbox items as read. |

## Validation

| Check | Result |
|---|---:|
| TypeScript validation | Passed |
| Focused unit tests | 9 / 9 passed |

## Remaining Boundary

The repository implementation is complete for this tranche. Physical-device verification is still recommended for gesture feel, notification timing, and mobile lifecycle nuances on iOS and Android.
