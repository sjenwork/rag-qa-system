// 載入導覽列
document.addEventListener('DOMContentLoaded', function() {
    fetch('/ai/components/navbar.html')
        .then(response => response.text())
        .then(html => {
            // 插入導覽列
            document.body.insertAdjacentHTML('afterbegin', html);
            
            // 設置當前頁面的導覽連結樣式
            const currentPath = window.location.pathname;
            document.querySelectorAll('.nav-link').forEach(link => {
                if (link.getAttribute('href') === currentPath) {
                    link.classList.add('text-blue-700', 'dark:text-blue-500');
                }
            });

            // 處理行動版選單的開關
            const menuButton = document.querySelector('[data-collapse-toggle="navbar-main"]');
            const menu = document.getElementById('navbar-main');
            
            if (menuButton && menu) {
                menuButton.addEventListener('click', () => {
                    menu.classList.toggle('hidden');
                });
            }
        })
        .catch(error => console.error('Error loading navbar:', error));
}); 