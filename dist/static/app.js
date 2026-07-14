const previewInput = document.querySelector("[data-preview-input]");
const previewImage = document.querySelector("[data-preview-image]");

if (previewInput && previewImage) {
    previewInput.addEventListener("change", () => {
        const file = previewInput.files && previewInput.files[0];
        if (!file) {
            previewImage.hidden = true;
            previewImage.removeAttribute("src");
            return;
        }
        previewImage.src = URL.createObjectURL(file);
        previewImage.hidden = false;
    });
}

document.querySelectorAll("form[data-confirm]").forEach((form) => {
    form.addEventListener("submit", (event) => {
        const message = form.getAttribute("data-confirm") || "دڵنیایت؟";
        if (!window.confirm(message)) {
            event.preventDefault();
        }
    });
});
