# Kids Health Cards

Mobile-friendly Home Assistant dashboard cards for logging a child's medicine, temperature and breastfeeding.
The cards contain no entity IDs of their own — each card finds its helpers from a per-child `prefix`.

| Card | What it shows |
|---|---|
| `custom:kh-status-card` | Temperature tile (red at fever) + last-dose tiles with "Wait · HH:MM" / "OK to give" |
| `custom:kh-medicine-card` | Medicine chips, dose stepper, "Given at" time picker, gap/max warning, two-tap log button |
| `custom:kh-temperature-card` | Temperature stepper, 24 h trend with dashed fever line, log button |
| `custom:kh-child-card` | Family-view panel per child: fever badge, medicine / feed / nappy / temperature tiles, quick-action buttons |
| `custom:kh-timeline-card` | Several children on one 24 h timeline — doses, feeds, nappies and temperatures as coloured dots (from the log entity) |
| `custom:kh-elapsed-card` | Count-up timer (mm:ss) from an `input_datetime`, ticking every second |

## Install (HACS)

1. HACS → ⋮ → **Custom repositories** → add this repository's URL, type **Dashboard**.
2. Download **Kids Health Cards**, then reload the browser / app.

## Usage

```yaml
type: custom:kh-status-card
prefix: kid1
medicines: [Panadol, Nurofen]   # optional
---
type: custom:kh-medicine-card
prefix: kid1
confirm: true                    # optional, two-tap confirm (default true)
---
type: custom:kh-temperature-card
prefix: kid1
fever: 38                        # optional
hours: 24                        # optional
show_graph: true                 # optional; false hides the built-in sparkline (use a history-graph card instead)
---
type: custom:kh-child-card
prefix: kid1
name: Kid 1
tiles: [medicine:Panadol, medicine:Nurofen]   # also: feed, nappy, temperature
actions:
  - label: + Medicine
    color: "#6A4BB5"
    navigation_path: /dashboard-tablet/kid1
  - label: Details
    navigation_path: /dashboard-tablet/kid1
---
type: custom:kh-timeline-card
hours: 24                        # optional
children:
  - name: Kid 1
    prefix: kid1                 # reads logbook entries of input_text.kid1_health_log
  - name: Kid 2
    prefix: kid2
---
type: custom:kh-elapsed-card
entity: input_datetime.kid1_feed_started
running_entity: input_boolean.kid1_breastfeeding
side_entity: input_select.kid1_breast_side
tap_script: script.kid1_breast_stop
name: Feeding
subtitle: tap to stop
```

## Expected helpers (for `prefix: kid1`)

| Purpose | Entity |
|---|---|
| Medicine choice (options e.g. Panadol, Nurofen, Other) | `input_select.kid1_medicine` |
| Name for "Other" | `input_text.kid1_medicine_other` |
| Dose | `input_number.kid1_medicine_dose` |
| Given-at time / picked flag | `input_datetime.kid1_given_at_time` (time only), `input_boolean.kid1_given_at_custom` |
| Last dose / doses today, per medicine | `input_datetime.kid1_<medicine>_last`, `counter.kid1_<medicine>_today` (Other → `other_medicine`) |
| Limits, shared per medicine (0 = off) | `input_number.<medicine>_min_gap` (h), `input_number.<medicine>_max_daily` |
| Temperature entry / logged / last logged | `input_number.kid1_temperature_entry`, `input_number.kid1_temperature`, `input_datetime.kid1_temperature_last_logged` |
| Feed / nappy (for `feed` and `nappy` tiles) | `input_boolean.kid1_breastfeeding`, `input_select.kid1_breast_side`, `input_datetime.kid1_last_feed`, `input_text.kid1_last_feed_detail`, `counter.kid1_feeds_today`, `input_number.kid1_bottle_today`, `counter.kid1_wet_today`, `counter.kid1_dirty_today`, `counter.kid1_wet_and_dirty_today`, `input_datetime.kid1_last_nappy` |
| Log entity (timeline) | `input_text.kid1_health_log` — scripts write `logbook.log` entries against it, message like `Panadol · 5.0 mL` |
| Log scripts | `script.kid1_log_medicine`, `script.kid1_log_temperature` |

The cards only display state and call these helpers and scripts; logging logic lives in Home Assistant.
