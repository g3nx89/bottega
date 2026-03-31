# Bottega APL Query Templates

All queries target the `bottega-logs` dataset. Replace placeholders (`<sid>`, `<time>`, etc.)
with actual values. Adjust time ranges to be as narrow as possible.

## Schema Discovery

```apl
// Always run first — confirm available fields
['bottega-logs']
| where _time > ago(15m)
| getschema

// Sample a raw event to see actual field values
['bottega-logs']
| where _time > ago(15m)
| take 1
```

## Session Replay

```apl
// Find a session by approximate time and symptoms
['bottega-logs']
| where _time between (datetime("<start>") .. datetime("<end>"))
| where event startswith "usage:"
| summarize events = count(), hasError = countif(event contains "error" or event contains "crash") by sid
| where hasError > 0
| sort by events desc

// Full session timeline
['bottega-logs']
| where sid == "<sid>"
| where event startswith "usage:"
| project _time, event, toolName, errorMessage, sentiment, processRssMB, eventLoopLagMs
| sort by _time

// System context for a session
['bottega-logs']
| where sid == "<sid>" and event == "usage:app_launch"
| project _time, ['system.appVersion'], ['system.os'], ['system.osRelease'],
          ['system.arch'], ['system.totalRamGB'], ['system.cpuModel'],
          ['model.provider'], ['model.modelId']

// Single turn reconstruction (all events for a specific prompt)
['bottega-logs']
| where sid == "<sid>" and promptId == "<promptId>"
| project _time, event, toolName, success, durationMs, errorMessage
| sort by _time

// Vitals timeline for a session (detect memory leaks, lag spikes)
['bottega-logs']
| where sid == "<sid>" and event == "usage:heartbeat"
| project _time, processRssMB, processHeapMB, freeRamGB, eventLoopLagMs,
          figmaWsConnected, rendererResponsive
| sort by _time
```

## Feedback Analysis

```apl
// Recent negative feedback (last 7 days)
['bottega-logs']
| where event == "usage:feedback" and sentiment == "negative"
| project _time, sid, slotId, promptId, turnIndex, issueType, details
| sort by _time desc

// Feedback sentiment ratio over time
['bottega-logs']
| where event == "usage:feedback"
| summarize positive = countif(sentiment == "positive"),
            negative = countif(sentiment == "negative")
  by bin(_time, 1d)
| extend ratio = positive * 100.0 / (positive + negative)
| sort by _time

// Negative feedback grouped by issue type
['bottega-logs']
| where event == "usage:feedback" and sentiment == "negative"
| summarize count() by issueType
| sort by count_ desc

// Full turn context around a feedback event
// Step 1: get the promptId from the feedback event
// Step 2: pull all events for that promptId
['bottega-logs']
| where sid == "<sid>" and promptId == "<promptId>"
| project _time, event, toolName, success, durationMs, errorMessage,
          sentiment, issueType, details
| sort by _time

// Feedback correlated with tool errors (find if negative feedback follows failures)
['bottega-logs']
| where event in ("usage:feedback", "usage:tool_error")
| where _time > ago(7d)
| project _time, sid, event, promptId, turnIndex, sentiment, issueType, toolName, errorMessage
| sort by sid, _time
```

## Crash Investigation

```apl
// All crashes in a time window
['bottega-logs']
| where event in ("usage:uncaught_exception", "usage:unhandled_rejection", "usage:renderer_crash")
| project _time, sid, event, errorName, errorMessage, errorCode, reason, exitCode,
          processRssMB, processHeapMB, eventLoopLagMs
| sort by _time desc

// Crash frequency by error signature (deduplicated)
['bottega-logs']
| where event in ("usage:uncaught_exception", "usage:unhandled_rejection", "usage:renderer_crash")
| summarize occurrences = count(),
            sessions = dcount(sid),
            lastSeen = max(_time),
            firstSeen = min(_time)
  by errorName, errorMessage
| sort by occurrences desc

// Crash context: vitals in the 60s before a crash
['bottega-logs']
| where sid == "<sid>" and event == "usage:heartbeat"
| where _time between (datetime("<crash_time_minus_60s>") .. datetime("<crash_time>"))
| project _time, processRssMB, processHeapMB, freeRamGB, eventLoopLagMs
| sort by _time

// Activity just before crash (what was the agent doing?)
['bottega-logs']
| where sid == "<sid>"
| where _time between (datetime("<crash_time_minus_30s>") .. datetime("<crash_time>"))
| where event startswith "usage:"
| project _time, event, toolName, success, durationMs, errorMessage
| sort by _time

// Crashes by app version (are newer versions more stable?)
['bottega-logs']
| where event in ("usage:uncaught_exception", "usage:unhandled_rejection", "usage:renderer_crash")
| join kind=inner (
    ['bottega-logs'] | where event == "usage:app_launch" | project sid, appVersion = ['system.appVersion']
  ) on sid
| summarize crashCount = count() by appVersion
| sort by crashCount desc

// Crashes correlated with system specs
['bottega-logs']
| where event in ("usage:uncaught_exception", "usage:unhandled_rejection")
| join kind=inner (
    ['bottega-logs'] | where event == "usage:app_launch"
    | project sid, os = ['system.os'], osRelease = ['system.osRelease'],
              ram = ['system.totalRamGB'], arch = ['system.arch']
  ) on sid
| summarize count() by os, osRelease, arch, ram
| sort by count_ desc
```

## Tool Error Investigation

```apl
// Tool error landscape (which tools fail most?)
['bottega-logs']
| where event == "usage:tool_error"
| summarize errorCount = count(), sessions = dcount(sid) by toolName
| sort by errorCount desc

// Error rate per tool (errors / total calls)
['bottega-logs']
| where event in ("usage:tool_call", "usage:tool_error")
| summarize total = countif(event == "usage:tool_call"),
            errors = countif(event == "usage:tool_error")
  by toolName
| where total > 0
| extend errorRate = errors * 100.0 / total
| where errors > 0
| sort by errorRate desc

// Specific tool error timeline and messages
['bottega-logs']
| where event == "usage:tool_error" and toolName == "<toolName>"
| project _time, sid, errorMessage, errorCode
| sort by _time desc

// Tool errors by category
['bottega-logs']
| where event == "usage:tool_error"
| summarize errorCount = count() by toolName, category
| sort by errorCount desc

// Tool performance (slow tools)
['bottega-logs']
| where event == "usage:tool_call" and success == true
| summarize p50 = percentile(durationMs, 50),
            p95 = percentile(durationMs, 95),
            p99 = percentile(durationMs, 99),
            calls = count()
  by toolName
| where calls > 10
| sort by p95 desc
```

## Performance Investigation

```apl
// Sessions with high event loop lag
['bottega-logs']
| where event == "usage:heartbeat" and eventLoopLagMs > 100
| summarize maxLag = max(eventLoopLagMs), avgLag = avg(eventLoopLagMs),
            maxHeap = max(processHeapMB)
  by sid
| sort by maxLag desc

// Memory growth pattern for a session (detect leaks)
['bottega-logs']
| where sid == "<sid>" and event == "usage:heartbeat"
| project _time, processRssMB, processHeapMB, freeRamGB, uptimeSeconds
| sort by _time

// Sessions with monotonically growing heap (leak candidates)
['bottega-logs']
| where event == "usage:heartbeat"
| summarize minHeap = min(processHeapMB), maxHeap = max(processHeapMB),
            uptimeMin = max(uptimeSeconds) / 60
  by sid
| where maxHeap > minHeap * 2 and uptimeMin > 5
| sort by maxHeap desc

// Figma connection stability
['bottega-logs']
| where event in ("usage:figma_connected", "usage:figma_disconnected")
| summarize connects = countif(event == "usage:figma_connected"),
            disconnects = countif(event == "usage:figma_disconnected")
  by sid
| where disconnects > 2
| sort by disconnects desc

// Renderer responsiveness issues
['bottega-logs']
| where event == "usage:heartbeat" and rendererResponsive == false
| project _time, sid, processRssMB, processHeapMB, eventLoopLagMs
| sort by _time desc
```

## Compact Issue Report Generation

```apl
// Crash summary (for issue report)
['bottega-logs']
| where event in ("usage:uncaught_exception", "usage:unhandled_rejection", "usage:renderer_crash")
| where _time > ago(7d)
| summarize occurrences = count(),
            affectedSessions = dcount(sid),
            lastSeen = max(_time)
  by event, errorName, errorMessage
| sort by occurrences desc

// Tool error summary (for issue report)
['bottega-logs']
| where event == "usage:tool_error"
| where _time > ago(7d)
| summarize errors = count(),
            affectedSessions = dcount(sid),
            lastSeen = max(_time)
  by toolName, errorMessage
| sort by errors desc

// Negative feedback summary (for issue report)
['bottega-logs']
| where event == "usage:feedback" and sentiment == "negative"
| where _time > ago(7d)
| summarize count = count() by issueType
| sort by count desc

// Overall health summary
['bottega-logs']
| where _time > ago(7d) and event startswith "usage:"
| summarize
    launches = countif(event == "usage:app_launch"),
    crashes = countif(event in ("usage:uncaught_exception", "usage:unhandled_rejection", "usage:renderer_crash")),
    toolErrors = countif(event == "usage:tool_error"),
    negativeFeedback = countif(event == "usage:feedback" and sentiment == "negative"),
    positiveFeedback = countif(event == "usage:feedback" and sentiment == "positive"),
    totalPrompts = countif(event == "usage:prompt"),
    totalToolCalls = countif(event == "usage:tool_call")
| extend crashRate = crashes * 100.0 / launches,
         toolErrorRate = toolErrors * 100.0 / totalToolCalls,
         feedbackNegRate = negativeFeedback * 100.0 / (negativeFeedback + positiveFeedback)
```

## Usage Analytics (Bonus)

```apl
// Daily active users
['bottega-logs']
| where event == "usage:app_launch"
| summarize dau = dcount(['system.anonymousId']) by bin(_time, 1d)
| sort by _time

// Model usage distribution
['bottega-logs']
| where event == "usage:session_start"
| summarize count() by ['model.provider'], ['model.modelId']
| sort by count_ desc

// Suggestion engagement rate
['bottega-logs']
| where event in ("usage:suggestions_generated", "usage:suggestion_clicked")
| summarize generated = countif(event == "usage:suggestions_generated"),
            clicked = countif(event == "usage:suggestion_clicked")
| extend clickRate = clicked * 100.0 / generated

// Image generation success by type
['bottega-logs']
| where event == "usage:image_gen"
| summarize total = count(),
            failed = countif(success == false),
            avgMs = avg(durationMs)
  by imageType
| extend errorRate = failed * 100.0 / total
| sort by total desc
```
