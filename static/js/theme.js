// 主題切換按鈕 HTML
const themeToggleButton = `
    <button id="themeToggle" class="fixed bottom-6 right-6 p-3 rounded-full bg-white dark:bg-gray-800 shadow-lg z-50 transition-all duration-300 hover:shadow-xl">
        <!-- 太陽圖標 (淺色模式顯示) -->
        <svg id="sunIcon" class="w-6 h-6 text-yellow-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"></path>
        </svg>
        <!-- 月亮圖標 (深色模式顯示) -->
        <svg id="moonIcon" class="w-6 h-6 text-blue-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"></path>
        </svg>
    </button>
`;

// 初始化主題切換功能
function initThemeToggle() {
    // 插入主題切換按鈕
    document.body.insertAdjacentHTML('beforeend', themeToggleButton);

    const themeToggleBtn = document.getElementById('themeToggle');
    const sunIcon = document.getElementById('sunIcon');
    const moonIcon = document.getElementById('moonIcon');
    const htmlElement = document.documentElement;
    
    // 更新圖標顯示
    function updateThemeIcons() {
        const isDark = htmlElement.classList.contains('dark');
        if (isDark) {
            sunIcon.classList.add('hidden');
            moonIcon.classList.remove('hidden');
        } else {
            sunIcon.classList.remove('hidden');
            moonIcon.classList.add('hidden');
        }
    }
    
    // 切換主題
    function toggleTheme() {
        if (htmlElement.classList.contains('dark')) {
            htmlElement.classList.remove('dark');
            htmlElement.classList.add('light');
            localStorage.theme = 'light';
        } else {
            htmlElement.classList.remove('light');
            htmlElement.classList.add('dark');
            localStorage.theme = 'dark';
        }
        updateThemeIcons();
    }
    
    // 初始化時更新圖標
    updateThemeIcons();
    
    // 綁定點擊事件
    if (themeToggleBtn) {
        themeToggleBtn.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            toggleTheme();
        });
    }
}

// 當 DOM 載入完成後初始化主題切換功能
document.addEventListener('DOMContentLoaded', initThemeToggle); 