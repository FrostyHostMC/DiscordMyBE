use anyhow::{bail, Context, Result};
use rage_formats::{parse_yft, parse_ytd, Drawable};
use serde_json::{json, Value};
use std::env;
use std::fs;
use std::path::{Path, PathBuf};

fn drawable_summary(drawable: &Drawable) -> Value {
    let models: usize = drawable.lods.iter().map(|lod| lod.models.len()).sum();
    let geometries: usize = drawable.lods.iter()
        .flat_map(|lod| lod.models.iter())
        .map(|model| model.geometries.len())
        .sum();
    let vertices: u64 = drawable.lods.iter()
        .flat_map(|lod| lod.models.iter())
        .flat_map(|model| model.geometries.iter())
        .map(|geometry| geometry.vertices_count as u64)
        .sum();
    let triangles: u64 = drawable.lods.iter()
        .flat_map(|lod| lod.models.iter())
        .flat_map(|model| model.geometries.iter())
        .map(|geometry| geometry.triangles_count as u64)
        .sum();

    json!({
        "name": drawable.name,
        "name_hash": format!("0x{:08X}", drawable.name_hash),
        "lods": drawable.lods.iter().map(|lod| json!({
            "level": lod.level.to_string(),
            "model_count": lod.models.len(),
            "geometry_count": lod.models.iter().map(|model| model.geometries.len()).sum::<usize>(),
            "triangle_count": lod.models.iter().flat_map(|model| model.geometries.iter()).map(|geometry| geometry.triangles_count as u64).sum::<u64>()
        })).collect::<Vec<_>>(),
        "model_count": models,
        "geometry_count": geometries,
        "vertex_count_sum_across_lods": vertices,
        "triangle_count_sum_across_lods": triangles,
        "bounds": {
            "sphere_radius": drawable.bounds.sphere_radius,
            "box_min": [drawable.bounds.box_min.x, drawable.bounds.box_min.y, drawable.bounds.box_min.z],
            "box_max": [drawable.bounds.box_max.x, drawable.bounds.box_max.y, drawable.bounds.box_max.z]
        },
        "embedded_shader_texture_count": drawable.shader_group.as_ref().map(|group| group.textures.len()).unwrap_or(0)
    })
}

fn safe_texture_filename(name: &str, index: usize) -> String {
    let cleaned: String = name.chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.') {
                character
            } else {
                '_'
            }
        })
        .collect();
    let trimmed = cleaned.trim_matches('.');
    if trimmed.is_empty() {
        format!("texture_{index}")
    } else {
        trimmed.to_string()
    }
}

fn inspect_yft(input: &Path, output: &Path, bytes: &[u8]) -> Result<Value> {
    let fragment = parse_yft(bytes).context("rage-formats could not parse this YFT fragment")?;
    let main = fragment.drawable.as_ref().map(drawable_summary);
    let extra_drawables: Vec<Value> = fragment.extra_drawables.iter()
        .map(|entry| json!({
            "name": entry.name,
            "name_hash": format!("0x{:08X}", entry.hash),
            "drawable": drawable_summary(&entry.drawable)
        }))
        .collect();

    let child_summaries: Vec<Value> = fragment.children.iter().map(|child| json!({
        "group_index": child.group_index,
        "bone_tag": child.bone_tag,
        "has_drawable": child.drawable.is_some(),
        "drawable": child.drawable.as_ref().map(drawable_summary)
    })).collect();

    let report = json!({
        "schema_version": 1,
        "tool": "GTAV AutoPort Native Inspector",
        "resource_type": "YFT",
        "source_file": input.file_name().and_then(|value| value.to_str()).unwrap_or("input.yft"),
        "source_bytes": bytes.len(),
        "parse_result": "success",
        "target_platform": "undetermined",
        "ps4_compatible": null,
        "fragment": {
            "name": fragment.name,
            "bound_center": [fragment.bound_center.x, fragment.bound_center.y, fragment.bound_center.z],
            "bound_radius": fragment.bound_radius,
            "bone_transform_count": fragment.bone_transforms.len(),
            "main_drawable": main,
            "extra_drawable_count": extra_drawables.len(),
            "extra_drawables": extra_drawables,
            "physics_child_count": child_summaries.len(),
            "physics_children": child_summaries
        },
        "limitations": [
            "Read-only structural inspection only.",
            "This report does not convert or rewrite the YFT.",
            "A successful PC resource parse does not establish PS4 compatibility."
        ]
    });

    write_report(output, "yft-inspection.json", &report)?;
    Ok(report)
}

fn inspect_ytd(input: &Path, output: &Path, bytes: &[u8]) -> Result<Value> {
    let textures = parse_ytd(bytes).context("rage-formats could not parse this YTD texture dictionary")?;
    let texture_dir = output.join("textures");
    fs::create_dir_all(&texture_dir).context("could not create texture output directory")?;
    let mut entries = Vec::new();

    for (index, texture) in textures.iter().enumerate() {
        let base = safe_texture_filename(&texture.name, index);
        let filename = format!("{base}_{index}.dds");
        let destination = texture_dir.join(&filename);
        fs::write(&destination, texture.to_dds())
            .with_context(|| format!("could not write extracted texture {filename}"))?;
        entries.push(json!({
            "name": texture.name,
            "name_hash": format!("0x{:08X}", texture.name_hash),
            "width": texture.width,
            "height": texture.height,
            "depth": texture.depth,
            "format": texture.format.to_string(),
            "mip_levels": texture.levels,
            "stride": texture.stride,
            "dds_file": format!("textures/{filename}")
        }));
    }

    let report = json!({
        "schema_version": 1,
        "tool": "GTAV AutoPort Native Inspector",
        "resource_type": "YTD",
        "source_file": input.file_name().and_then(|value| value.to_str()).unwrap_or("input.ytd"),
        "source_bytes": bytes.len(),
        "parse_result": "success",
        "target_platform": "undetermined",
        "ps4_compatible": null,
        "texture_count": entries.len(),
        "textures": entries,
        "limitations": [
            "Textures are exported as DDS for inspection; the source YTD is not rewritten.",
            "A successful PC resource parse does not establish PS4 compatibility.",
            "Extracted DDS files are inspection artifacts, not a converted PS4 texture dictionary."
        ]
    });

    write_report(output, "ytd-inspection.json", &report)?;
    Ok(report)
}

fn write_report(output: &Path, filename: &str, report: &Value) -> Result<()> {
    fs::create_dir_all(output).context("could not create report directory")?;
    let text = serde_json::to_string_pretty(report)?;
    fs::write(output.join(filename), text).with_context(|| format!("could not write {filename}"))?;
    Ok(())
}

fn run() -> Result<()> {
    let mut args = env::args_os().skip(1);
    let input = args.next().map(PathBuf::from)
        .ok_or_else(|| anyhow::anyhow!("usage: gtav-autoport-inspector <file.yft|file.ytd> [output-directory]"))?;
    let output = args.next().map(PathBuf::from).unwrap_or_else(|| {
        let stem = input.file_stem().and_then(|value| value.to_str()).unwrap_or("resource");
        input.parent().unwrap_or_else(|| Path::new(".")).join(format!("{stem}-autoport-inspection"))
    });

    if args.next().is_some() {
        bail!("too many arguments; usage: gtav-autoport-inspector <file.yft|file.ytd> [output-directory]");
    }

    let extension = input.extension().and_then(|value| value.to_str()).unwrap_or("").to_ascii_lowercase();
    let bytes = fs::read(&input).with_context(|| format!("could not read {}", input.display()))?;
    let report = match extension.as_str() {
        "yft" => inspect_yft(&input, &output, &bytes)?,
        "ytd" => inspect_ytd(&input, &output, &bytes)?,
        _ => bail!("unsupported resource extension .{extension}; this inspector currently accepts YFT and YTD"),
    };

    println!("{}", serde_json::to_string_pretty(&json!({
        "status": "inspected",
        "report_directory": output,
        "resource_type": report["resource_type"],
        "ps4_compatible": null
    }))?);
    Ok(())
}

fn main() {
    if let Err(error) = run() {
        eprintln!("AutoPort inspection failed: {error:#}");
        std::process::exit(1);
    }
}

#[cfg(test)]
mod tests {
    use super::safe_texture_filename;

    #[test]
    fn texture_filename_removes_path_separators_and_unsafe_characters() {
        assert_eq!(safe_texture_filename("../car/body:diff", 3), "_car_body_diff");
    }

    #[test]
    fn empty_texture_name_gets_stable_fallback() {
        assert_eq!(safe_texture_filename("...", 7), "texture_7");
    }
}
