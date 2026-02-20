---
layout: default
title: "iPAS 考試重點補充"
permalink: /ipas/
---

<div class="ipas-index">

# iPAS 淨零碳規劃管理師（中級）考試重點補充

本專區整理 iPAS 淨零碳規劃管理師中級能力鑑定的**考試指引補充教材**，涵蓋考試常考但教科書著墨較少的進階主題。每個主題包含核心知識點、關鍵數據、以及範例考題解析。

<div class="ipas-cards">

{% for topic in site.data.ipas_topics %}
<a href="{{ topic.url | relative_url }}" class="ipas-card">
  <span class="ipas-card-num">{{ forloop.index }}</span>
  <h3>{{ topic.title }}</h3>
  <span class="ipas-card-unit">{{ topic.unit }}</span>
</a>
{% endfor %}

</div>

## 使用建議

- **搭配正課簡報**：本補充教材對應各單元的「指引補充」投影片，建議先完成正課學習再閱讀
- **重點標記**：每個主題標示「考試重點」與「常考數據」，方便考前快速複習
- **範例考題**：每個主題附有模擬試題，題型與正式考試一致（單選 / 複選）
- **音檔 / 影片**：後續將陸續補充 Podcast 導讀與影片摘要

</div>
