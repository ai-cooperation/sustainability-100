---
---
// Auto-generated podcast playlist — built by Jekyll at compile time
var PLAYLIST = [
  {% assign sorted = site.episodes | sort: "number" %}{% for ep in sorted %}{% assign en_audio = ep.podcast_en | default: ep.podcast_audio %}{
    n: {{ ep.number }},
    id: "{{ ep.ep_id }}",
    title: "{{ ep.title | escape }}",
    outline: "{{ ep.outline | escape | truncate: 60 }}",
    series: "{{ ep.series }}",
    seriesName: "{{ ep.series_name | escape }}",
    url: "{{ ep.url | relative_url }}",
    en: {% if en_audio %}"{{ '/assets/audio/' | append: ep.ep_id | append: '/' | append: en_audio | relative_url }}"{% else %}null{% endif %},
    zh: {% if ep.podcast_zh %}"{{ '/assets/audio/' | append: ep.ep_id | append: '/' | append: ep.podcast_zh | relative_url }}"{% else %}null{% endif %}
  }{% unless forloop.last %},{% endunless %}
  {% endfor %}
];
