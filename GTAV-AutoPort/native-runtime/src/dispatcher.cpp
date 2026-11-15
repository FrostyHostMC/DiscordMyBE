#include "autoport/game_api.hpp"

#include <cmath>
#include <type_traits>
#include <utility>

namespace autoport {
namespace {
bool finite(const Vec3& value) { return std::isfinite(value.x) && std::isfinite(value.y) && std::isfinite(value.z); }
bool valid_text(const std::string& value, std::size_t limit = 128) { return !value.empty() && value.size() <= limit; }
DispatchResult failed(const char* message) { return {false, 0, message}; }
}

DispatchResult Dispatcher::dispatch(const Action& action) const {
    return std::visit([this](const auto& item) -> DispatchResult {
        using T = std::decay_t<decltype(item)>;
        if constexpr (std::is_same_v<T, SpawnEntity>) {
            if (!valid_text(item.model) || !finite(item.position) || !finite(item.rotation) || !std::isfinite(item.heading)) return failed("invalid spawn model or transform");
            const auto handle = api_.spawn_entity(item);
            return handle ? DispatchResult{true, handle, {}} : failed("host rejected entity spawn");
        } else if constexpr (std::is_same_v<T, SetTransform>) {
            if (!item.entity || !finite(item.position) || !finite(item.rotation) || !std::isfinite(item.heading)) return failed("invalid entity transform");
            return api_.set_transform(item) ? DispatchResult{true, item.entity, {}} : failed("host rejected entity transform");
        } else if constexpr (std::is_same_v<T, AttachEntity>) {
            if (!item.parent || !item.child || item.parent == item.child || !valid_text(item.bone) || !finite(item.offset) || !finite(item.rotation)) return failed("invalid attachment reference or transform");
            return api_.attach_entity(item) ? DispatchResult{true, item.child, {}} : failed("host rejected attachment");
        } else if constexpr (std::is_same_v<T, SetVehicleProperty>) {
            if (!item.vehicle || !valid_text(item.property) || !std::isfinite(item.value)) return failed("invalid vehicle property");
            return api_.set_vehicle_property(item) ? DispatchResult{true, item.vehicle, {}} : failed("host rejected vehicle property");
        } else if constexpr (std::is_same_v<T, SetWantedLevel>) {
            if (item.level < 0 || item.level > 5) return failed("wanted level must be between 0 and 5");
            return api_.set_wanted_level(item) ? DispatchResult{true, 0, {}} : failed("host rejected wanted level");
        } else if constexpr (std::is_same_v<T, GrantReward>) {
            if (item.amount < 0 || item.amount > 2000000000LL) return failed("reward amount is outside the safe configured range");
            return api_.grant_reward(item) ? DispatchResult{true, 0, {}} : failed("host rejected reward");
        } else if constexpr (std::is_same_v<T, IssuePedTask>) {
            if (!item.ped || !valid_text(item.task) || item.task.size() > 96) return failed("invalid ped task");
            return api_.issue_ped_task(item) ? DispatchResult{true, item.ped, {}} : failed("host rejected ped task");
        } else if constexpr (std::is_same_v<T, SetEntityHealth>) {
            if (!item.entity || !std::isfinite(item.health) || item.health < 0 || item.health > 10000) return failed("invalid entity health value");
            return api_.set_entity_health(item) ? DispatchResult{true, item.entity, {}} : failed("host rejected entity health");
        } else if constexpr (std::is_same_v<T, CreateExplosion>) {
            if (!finite(item.position) || item.type < 0 || item.type > 100 || !std::isfinite(item.damageScale) || item.damageScale < 0 || item.damageScale > 10) return failed("invalid explosion parameters");
            return api_.create_explosion(item) ? DispatchResult{true, 0, {}} : failed("host rejected explosion");
        } else {
            return failed("unsupported runtime action");
        }
    }, action);
}

} // namespace autoport
