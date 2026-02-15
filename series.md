---
layout: default
title: "系列總覽"
---

# 系列總覽

{% for s in site.data.series %}
## {{ s.id }}｜{{ s.name }}

{% assign eps = site.episodes | where: "series", s.id | sort: "number" %}
{% if eps.size > 0 %}
{% for ep in eps %}
- [{{ ep.ep_id }}｜{{ ep.title }}]({{ ep.url | relative_url }})
{% endfor %}
{% else %}
_即將推出_
{% endif %}

{% endfor %}
