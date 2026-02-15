// Series filter
document.addEventListener('DOMContentLoaded', function() {
  const btns = document.querySelectorAll('.filter-btn');
  const cards = document.querySelectorAll('.episode-card');

  btns.forEach(function(btn) {
    btn.addEventListener('click', function() {
      btns.forEach(function(b) { b.classList.remove('active'); });
      btn.classList.add('active');

      var series = btn.getAttribute('data-series');
      cards.forEach(function(card) {
        if (series === 'all' || card.getAttribute('data-series') === series) {
          card.style.display = '';
        } else {
          card.style.display = 'none';
        }
      });
    });
  });
});
