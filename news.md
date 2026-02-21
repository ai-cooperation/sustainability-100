---
layout: default
title: "永續動態"
permalink: /news/
---
<div class="news-page">
  <div class="news-hero">
    <h1>永續動態</h1>
    <p class="news-hero-sub">追蹤最新永續趨勢，連結 100 講核心知識</p>
  </div>

  {% assign news = site.posts | sort: "date" | reverse %}
  {% if news.size > 0 %}
  <div class="news-list">
    {% for post in news %}
    <a href="{{ post.url | relative_url }}" class="news-card">
      {% if post.image %}
      <div class="news-card-image">
        <img src="{{ '/assets/images/news/' | append: post.image | relative_url }}" alt="{{ post.title }}" loading="lazy">
      </div>
      {% endif %}
      <div class="news-card-body">
        <div class="news-card-meta">
          <time>{{ post.date | date: "%Y-%m-%d" }}</time>
          {% if post.source %}
          <span class="news-card-source">{{ post.source }}</span>
          {% endif %}
        </div>
        <h3>{{ post.title }}</h3>
        {% if post.summary %}
        <p>{{ post.summary }}</p>
        {% endif %}
        {% if post.tags and post.tags.size > 0 %}
        <div class="news-card-tags">
          {% for tag in post.tags %}
          <span class="news-tag">{{ tag }}</span>
          {% endfor %}
        </div>
        {% endif %}
        {% if post.related_episodes and post.related_episodes.size > 0 %}
        <div class="news-card-episodes">
          {% for ep in post.related_episodes %}
          <span class="news-ep-tag">{{ ep }}</span>
          {% endfor %}
        </div>
        {% endif %}
      </div>
    </a>
    {% endfor %}
  </div>
  {% else %}
  <div class="news-empty">
    <p>即將推出永續最新動態追蹤，敬請期待！</p>
  </div>
  {% endif %}
</div>
