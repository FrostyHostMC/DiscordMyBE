import { world, system } from "@minecraft/server";
import { ActionFormData } from "@minecraft/server-ui";

const STICK_ID = "minecraft:stick";
const CAMERA_OBJECTIVE = "c";

// Cooldown để tránh spam mở menu
const menuCooldown = new Set();
// Lưu trạng thái camera của người chơi
const playerCameraState = new Map();

/**
 * Lấy hoặc tạo objective trên scoreboard
 */
function getOrCreateObjective(name) {
    let objective = world.scoreboard.getObjective(name);
    if (!objective) {
        objective = world.scoreboard.addObjective(name, name);
    }
    return objective;
}

/**
 * Reset camera về mặc định của Minecraft
 */
function resetToDefaultCamera(player) {
    player.camera.clear();
    // Đảm bảo camera ở vị trí mặc định
    player.camera.setCamera("minecraft:follow_orbit", {
        entityOffset: { x: 0, y: 1.62, z: 0 },
        radius: 4.0,
        rotation: { x: 0, y: 0 }
    });
}

/**
 * Áp dụng góc nhìn thứ nhất (First Person)
 */
function applyFirstPerson(player) {
    // Dùng thẳng preset gốc "minecraft:first_person" (giống hệt khi bấm F5),
    // đảm bảo engine nhận đúng là first person và tự ẩn đầu nhân vật
    player.camera.setCamera("minecraft:first_person");
    
    const objective = getOrCreateObjective(CAMERA_OBJECTIVE);
    objective.setScore(player, 0);
    playerCameraState.set(player.id, "first");
    player.onScreenDisplay.setActionBar("§bĐã chuyển sang góc nhìn thứ nhất");
}

/**
 * Áp dụng góc nhìn thứ ba (Third Person)
 */
function applyThirdPerson(player, isFar = false) {
    player.camera.clear();
    
    const radius = isFar ? 8.0 : 4.0;
    const score = isFar ? 2 : 1;
    const state = isFar ? "third_far" : "third";
    const color = isFar ? "§e" : "§a";
    const label = isFar ? "distant third-person perspective" : "third-person perspective";
    
    player.camera.setCamera("minecraft:follow_orbit", {
        entityOffset: { x: 0, y: 1.62, z: 0 },
        radius: radius,
        rotation: { x: 0, y: 0 }
    });
    
    const objective = getOrCreateObjective(CAMERA_OBJECTIVE);
    objective.setScore(player, score);
    playerCameraState.set(player.id, state);
    player.onScreenDisplay.setActionBar(`${color}Đã chuyển sang ${label}`);
}

/**
 * Mở menu chọn góc nhìn
 */
function openPerspectiveMenu(player) {
    const form = new ActionFormData()
        .title("§l§6CAMERA PERSPECTIVE")
        .body("§7Choose the viewing angle you want to use.:")
        .button("§bFirst Person")
        .button("§aThird Person")
        .button("§eThird Person Far");

    form.show(player).then((response) => {
        if (response.canceled || response.selection === undefined) return;

        switch(response.selection) {
            case 0:
                applyFirstPerson(player);
                break;
            case 1:
                applyThirdPerson(player, false);
                break;
            case 2:
                applyThirdPerson(player, true);
                break;
        }
    }).catch((error) => {
        console.warn(`CameraSystem: Lỗi khi hiển thị menu - ${error}`);
    });
}

/**
 * Cấp gậy đặc biệt cho người chơi
 */
function giveSpecialStick(player) {
    const inventory = player.getComponent("inventory").container;
    if (!inventory) return;
    
    // Kiểm tra xem đã có gậy chưa
    for (let i = 0; i < inventory.size; i++) {
        const item = inventory.getItem(i);
        if (item && item.typeId === STICK_ID) {
            // Đã có gậy, không cấp thêm
            return;
        }
    }
    
    // Tạo gậy với lore đặc biệt
    const stick = {
        typeId: STICK_ID,
        amount: 1,
        components: {
            "minecraft:item_lock": {
                mode: "lock_in_slot" // Khóa trong slot
            },
            "minecraft:can_destroy": {
                blocks: []
            },
            "minecraft:item_durability": {
                damage: 0,
                max_durability: 0 // Không thể hư
            }
        }
    };
    
    // Đặt vào hotbar slot 9 (index 8)
    inventory.setItem(8, stick);
    player.onScreenDisplay.setActionBar("§aĐã nhận gậy điều khiển góc nhìn!");
}

// ==================== SỰ KIỆN ====================

// Sự kiện khi người chơi dùng item (gậy)
world.afterEvents.itemUse.subscribe((event) => {
    const { source: player, itemStack } = event;

    if (!itemStack || itemStack.typeId !== STICK_ID) return;
    if (!player || player.typeId !== "minecraft:player") return;

    // Chặn spam mở menu
    if (menuCooldown.has(player.id)) return;
    menuCooldown.add(player.id);

    system.runTimeout(() => {
        menuCooldown.delete(player.id);
    }, 10);

    openPerspectiveMenu(player);
});

// NOTE: world.afterEvents.cameraChange is not available in the Script API
// version used by the target runtime. Subscribing to it crashes module startup
// and prevents all later event handlers from registering. Do not use it here.
// Camera changes are handled only by the explicit menu actions below.

// Ngăn người chơi vứt gậy
world.beforeEvents.inventory.drop.subscribe((event) => {
    const item = event.droppedItem;
    if (item && item.typeId === STICK_ID) {
        event.cancel = true;
        event.source.onScreenDisplay.setActionBar("§cKhông thể vứt gậy điều khiển góc nhìn!");
    }
});

// Ngăn người chơi di chuyển gậy trong kho đồ
world.beforeEvents.inventory.move.subscribe((event) => {
    const item = event.item;
    if (item && item.typeId === STICK_ID) {
        event.cancel = true;
        event.source.onScreenDisplay.setActionBar("§cKhông thể di chuyển gậy điều khiển góc nhìn!");
    }
});

// Cấp gậy khi người chơi join
world.afterEvents.playerSpawn.subscribe((event) => {
    const player = event.player;
    
    if (event.initialSpawn) {
        // Reset camera
        player.camera.clear();
        playerCameraState.delete(player.id);
        const objective = world.scoreboard.getObjective(CAMERA_OBJECTIVE);
        if (objective) {
            objective.removeScore(player);
        }
        
        // Cấp gậy sau 1 giây
        system.runTimeout(() => {
            giveSpecialStick(player);
        }, 20);
    }
});

// Cấp gậy khi người chơi respawn
world.afterEvents.entityDie.subscribe((event) => {
    const entity = event.deadEntity;
    if (entity.typeId === "minecraft:player") {
        const player = entity;
        // Reset camera khi chết
        system.runTimeout(() => {
            player.camera.clear();
            playerCameraState.delete(player.id);
            // Cấp lại gậy
            giveSpecialStick(player);
        }, 10);
    }
});

// Đảm bảo gậy luôn ở slot 9
system.runInterval(() => {
    for (const player of world.getPlayers()) {
        const inventory = player.getComponent("inventory").container;
        if (!inventory) continue;
        
        // Kiểm tra slot 9 (index 8)
        const slotItem = inventory.getItem(8);
        if (!slotItem || slotItem.typeId !== STICK_ID) {
            // Nếu không có gậy ở slot 9, tìm và di chuyển về slot 9
            let found = false;
            for (let i = 0; i < inventory.size; i++) {
                const item = inventory.getItem(i);
                if (item && item.typeId === STICK_ID) {
                    // Di chuyển về slot 9
                    inventory.setItem(8, item);
                    inventory.setItem(i, undefined);
                    found = true;
                    break;
                }
            }
            
            // Nếu không tìm thấy gậy, cấp mới
            if (!found) {
                giveSpecialStick(player);
            }
        }
    }
}, 100); // Kiểm tra mỗi 5 giây

// Sự kiện khi người chơi rời game
world.afterEvents.playerLeave.subscribe((event) => {
    const player = event.player;
    const objective = world.scoreboard.getObjective(CAMERA_OBJECTIVE);
    if (objective) {
        objective.removeScore(player);
    }
    playerCameraState.delete(player.id);
});

// Lệnh để reset camera
world.beforeEvents.chatSend.subscribe((event) => {
    const message = event.message.toLowerCase();
    const player = event.sender;
    
    if (message === "/resetcamera" || message === "/rc") {
        event.cancel = true;
        player.camera.clear();
        playerCameraState.delete(player.id);
        const objective = world.scoreboard.getObjective(CAMERA_OBJECTIVE);
        if (objective) {
            objective.removeScore(player);
        }
        player.onScreenDisplay.setActionBar("§aĐã reset camera về mặc định");
    }
});

// Console log khi script load
console.log("=== Camera System đã được tải thành công! ===");
console.log("Sử dụng gậy (Stick) để mở menu chọn góc nhìn");
console.log("Gậy được khóa ở slot 9, không thể vứt hoặc di chuyển");
console.log("Gõ /resetcamera hoặc /rc để reset camera về mặc định");